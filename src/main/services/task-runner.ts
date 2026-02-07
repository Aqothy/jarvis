import { Notification, app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ImageTaskRequest,
  ImageTaskResult,
  TextDeliveryMode,
  TextPromptMode,
  TextTaskRequest,
  TextTaskResult,
} from "../types";
import { captureContextSnapshot } from "./context-service";
import {
  createImageFromBuffer,
  insertTextAtCursor,
  writeClipboardImage,
  writeClipboardText,
} from "./macos-service";
import { createMemory, getMemoryPromptContextForQuery } from "./memory-service";
import { transformClipboardImage } from "./openai-service";
import { cleanMemoryCandidate, transformText } from "./gemini-service";

interface TextTaskPlan {
  promptMode: TextPromptMode;
  deliveryMode: TextDeliveryMode;
  requiresClipboardText: boolean;
}

interface MemoryAddCommand {
  content: string;
}

function getOutputDir(): string {
  return join(app.getPath("userData"), "outputs");
}

async function ensureOutputDir(): Promise<void> {
  await mkdir(getOutputDir(), { recursive: true });
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function hasExplicitClipboardReference(instruction: string): boolean {
  const explicitClipboardPatterns = [
    /\bclipboard\b/,
    /\bselected text\b/,
    /\bselection\b/,
    /\bcopied text\b/,
    /\bthis text\b/,
    /\bthis paragraph\b/,
    /\bthis sentence\b/,
    /\bthis message\b/,
    /\bthis email\b/,
    /\btext above\b/,
    /\btext below\b/,
    /\bthe above text\b/,
    /\bthe below text\b/,
  ];

  return explicitClipboardPatterns.some((pattern) => pattern.test(instruction));
}

function normalizeInstruction(instruction: string): string {
  return instruction.toLowerCase().trim().replace(/\s+/g, " ");
}

function stripAssistantLeadIn(instruction: string): string {
  return instruction
    .replace(/^(hey|hi|yo)\s+(jarvis[,!\s]*)?/i, "")
    .replace(/^(can|could|would|will)\s+you\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/^i need you to\s+/i, "")
    .replace(/^help me\s+/i, "help me ")
    .trim();
}

function cleanExtractedMemoryContent(content: string): string {
  return content
    .trim()
    .replace(/^(that|this|it)\s+/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function hasExplicitMemoryTarget(instruction: string): boolean {
  return /\b(?:to|in(?:to)?)\s+(?:your\s+)?memory\b/i.test(instruction);
}

function extractMemoryAddCommand(instruction: string): MemoryAddCommand | null {
  const cleanedInstruction = stripAssistantLeadIn(instruction.trim());
  if (cleanedInstruction.length === 0) {
    return null;
  }

  if (!hasExplicitMemoryTarget(cleanedInstruction)) {
    return null;
  }

  const patterns = [
    /^(.+?)[,.\s]+(?:add|save|remember)\s+(?:that|this|it)?\s*(?:to|in(?:to)?)\s+(?:your\s+)?memory[.!?]*$/i,
    /^(?:add|save|remember)\s+(.+?)\s+(?:to|in(?:to)?)\s+(?:your\s+)?memory[.!?]*$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(cleanedInstruction);
    if (!match || typeof match[1] !== "string") {
      continue;
    }

    const extractedContent = cleanExtractedMemoryContent(
      match[1]
        .trim()
        .replace(/^(hey|hi|yo)\s+jarvis[,!\s]*/i, "")
        .replace(/^(can|could|would|will)\s+you\s+/i, "")
        .replace(/^please\s+/i, "")
        .trim(),
    );

    if (extractedContent.length === 0) {
      continue;
    }

    return {
      content: extractedContent,
    };
  }

  return null;
}

function resolveTextTaskPlan(instruction: string): TextTaskPlan {
  const normalizedInstruction = normalizeInstruction(instruction);
  if (normalizedInstruction.length === 0) {
    return {
      promptMode: "dictation_cleanup",
      deliveryMode: "insert",
      requiresClipboardText: false,
    };
  }

  const routedInstruction = stripAssistantLeadIn(normalizedInstruction);

  const startsWithTransformVerb =
    /^(rewrite|rephrase|paraphrase|proofread|edit|polish|fix|improve|shorten|expand|translate|summarize)\b/.test(
      routedInstruction,
    );
  const startsWithExplainVerb =
    /^(explain|analyze|interpret|critique|help me understand|what does|what is|what'?s)\b/.test(
      routedInstruction,
    );
  const startsWithDirectQueryVerb =
    /^(research|explain|analyze|what|what'?s|who|when|where|why|how|compare|list|find|tell me)\b/.test(
      routedInstruction,
    );
  const startsWithGenerationVerb =
    /^(write|draft|compose|generate|create)\b/.test(routedInstruction);
  const referencesLocalText =
    /\b(this|it|text|paragraph|sentence|message|email|draft)\b/.test(
      routedInstruction,
    );
  const explicitClipboardReference = hasExplicitClipboardReference(
    normalizedInstruction,
  );
  const hasAssistantRequestCue =
    /\b(can|could|would|will)\s+you\b|\bplease\b|\bi need you to\b|\bhelp me\b/.test(
      normalizedInstruction,
    );
  const hasDirectQueryKeyword =
    /\b(explain|analyze|interpret|critique|research|compare|list|find|tell me|what is|what does|what are|what'?s|who|when|where|why|how)\b/.test(
      normalizedInstruction,
    );

  if (explicitClipboardReference || referencesLocalText) {
    if (startsWithExplainVerb) {
      return {
        promptMode: "clipboard_explain",
        deliveryMode: "clipboard",
        requiresClipboardText: true,
      };
    }

    return {
      promptMode: "clipboard_rewrite",
      deliveryMode: "insert",
      requiresClipboardText: true,
    };
  }

  if (startsWithTransformVerb) {
    return {
      promptMode: "direct_query",
      deliveryMode: "insert",
      requiresClipboardText: false,
    };
  }

  if (startsWithGenerationVerb) {
    return {
      promptMode: "direct_query",
      deliveryMode: "insert",
      requiresClipboardText: false,
    };
  }

  if (startsWithDirectQueryVerb) {
    return {
      promptMode: "direct_query",
      deliveryMode: "clipboard",
      requiresClipboardText: false,
    };
  }

  if (hasAssistantRequestCue && hasDirectQueryKeyword) {
    return {
      promptMode: "direct_query",
      deliveryMode: "clipboard",
      requiresClipboardText: false,
    };
  }

  return {
    promptMode: "dictation_cleanup",
    deliveryMode: "insert",
    requiresClipboardText: false,
  };
}

/**
 * Orchestrates text workflows:
 * 1. Capture what is currently in the clipboard.
 * 2. Route prompt + delivery mode (rewrite/explain/query/dictation).
 * 3. Send context to Gemini based on the selected mode.
 * 4. Insert at cursor or copy to clipboard based on delivery mode.
 */
export async function runTextTask(
  request: TextTaskRequest,
): Promise<TextTaskResult> {
  const memoryAddCommand =
    request.mode === "force_dictation"
      ? null
      : extractMemoryAddCommand(request.instruction);

  if (memoryAddCommand) {
    const context = await captureContextSnapshot({
      persistClipboardImage: false,
      includeClipboard: false,
    });

    const cleanedMemory = await cleanMemoryCandidate({
      instruction: request.instruction,
      candidate: memoryAddCommand.content,
      activeApp: context.activeApp,
    });

    if (!cleanedMemory.shouldSave) {
      notify("Jarvis", "Could not save memory. Try phrasing it more clearly.");
      return {
        context,
        sourceText: "",
        transformedText: "Memory was not saved.",
        promptMode: "direct_query",
        deliveryMode: "none",
        memoryUpdated: false,
        inserted: false,
        copiedToClipboard: false,
        fallbackCopiedToClipboard: false,
      };
    }

    createMemory({
      content: cleanedMemory.cleanedMemory,
      kind: cleanedMemory.kind,
      source: "explicit_voice",
    });
    notify("Jarvis", "Saved to memory.");

    return {
      context,
      sourceText: "",
      transformedText: `Saved to memory: ${cleanedMemory.cleanedMemory}`,
      promptMode: "direct_query",
      deliveryMode: "none",
      memoryUpdated: true,
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  const context = await captureContextSnapshot({
    persistClipboardImage: false,
  });
  const plan =
    request.mode === "force_dictation"
      ? {
          promptMode: "dictation_cleanup" as const,
          deliveryMode: "insert" as const,
          requiresClipboardText: false,
        }
      : resolveTextTaskPlan(request.instruction);
  let sourceText = "";
  const memoryContext =
    plan.promptMode === "dictation_cleanup"
      ? []
      : getMemoryPromptContextForQuery({
          query: request.instruction,
        });

  if (plan.requiresClipboardText) {
    sourceText = context.clipboard.text?.text ?? "";
    if (sourceText.trim().length === 0) {
      throw new Error(
        "No clipboard text found. Copy text to clipboard, then retry.",
      );
    }
  }

  const transformedText = await transformText({
    instruction: request.instruction,
    sourceText,
    activeApp: context.activeApp,
    mode: plan.promptMode,
    memoryContext,
  });

  let inserted = false;
  let copiedToClipboard = false;
  let fallbackCopiedToClipboard = false;

  if (plan.deliveryMode === "insert") {
    inserted = await insertTextAtCursor(transformedText);
    if (!inserted) {
      writeClipboardText(transformedText);
      copiedToClipboard = true;
      fallbackCopiedToClipboard = true;
      notify("Jarvis", "Insert failed. Response copied to clipboard.");
    }
  } else {
    writeClipboardText(transformedText);
    copiedToClipboard = true;
    fallbackCopiedToClipboard = true;
    notify("Jarvis", "Response copied to clipboard.");
  }

  return {
    context,
    sourceText,
    transformedText,
    promptMode: plan.promptMode,
    deliveryMode: plan.deliveryMode,
    memoryUpdated: false,
    inserted,
    copiedToClipboard,
    fallbackCopiedToClipboard,
  };
}

/**
 * Orchestrates the image transformation flow:
 * 1. Verify an image exists in the clipboard.
 * 2. Send image and instructions to OpenAI DALL-E (edits).
 * 3. Put the result back in the clipboard and notify the user.
 */
export async function runImageTask(
  request: ImageTaskRequest,
): Promise<ImageTaskResult> {
  const context = await captureContextSnapshot({ persistClipboardImage: true });
  if (context.clipboard.kind !== "image" || !context.clipboard.imagePath) {
    throw new Error(
      "No clipboard image found. Copy an image to clipboard, then retry.",
    );
  }

  const outputBuffer = await transformClipboardImage({
    imagePath: context.clipboard.imagePath,
    instruction: request.instruction,
  });

  const image = createImageFromBuffer(outputBuffer);
  writeClipboardImage(image);

  await ensureOutputDir();
  const outputImagePath = join(
    getOutputDir(),
    `image-output-${Date.now()}-${randomUUID()}.png`,
  );
  await writeFile(outputImagePath, outputBuffer);

  notify("Jarvis", "Image ready to paste.");

  return {
    context,
    outputImagePath,
  };
}
