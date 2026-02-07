import { Notification, app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ImageTaskRequest, ImageTaskResult, TextTaskRequest, TextTaskResult } from "../types";
import { captureContextSnapshot } from "./context-service";
import {
  createImageFromBuffer,
  insertTextAtCursor,
  writeClipboardImage,
  writeClipboardText
} from "./macos-service";
import { transformClipboardImage } from "./openai-service";
import { transformText } from "./gemini-service";

type TextPromptMode = "clipboard_rewrite" | "direct_query";

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

function shouldUseClipboardContext(instruction: string): boolean {
  const normalizedInstruction = instruction.toLowerCase().trim();
  if (normalizedInstruction.length === 0) {
    return true;
  }

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
    /\bthe below text\b/
  ];

  if (
    explicitClipboardPatterns.some((pattern) => pattern.test(normalizedInstruction))
  ) {
    return true;
  }

  const startsWithTransformVerb = /^(rewrite|rephrase|paraphrase|proofread|edit|polish|fix|improve|shorten|expand|translate|summarize)\b/.test(
    normalizedInstruction,
  );
  const referencesLocalText = /\b(this|it|text|paragraph|sentence|message|email|draft)\b/.test(
    normalizedInstruction,
  );

  return startsWithTransformVerb && referencesLocalText;
}

function resolveTextPromptMode(instruction: string): TextPromptMode {
  return shouldUseClipboardContext(instruction)
    ? "clipboard_rewrite"
    : "direct_query";
}

/**
 * Orchestrates the text rewrite flow:
 * 1. Capture what is currently in the clipboard.
 * 2. Route prompt mode (clipboard rewrite vs direct query).
 * 3. Send context to Gemini based on the selected mode.
 * 3. Attempt to paste the result back into the active app at the cursor.
 */
export async function runTextTask(request: TextTaskRequest): Promise<TextTaskResult> {
  const context = await captureContextSnapshot({ persistClipboardImage: false });
  const promptMode = resolveTextPromptMode(request.instruction);
  let sourceText = "";

  if (promptMode === "clipboard_rewrite") {
    sourceText = context.clipboard.text?.text ?? "";
    if (sourceText.trim().length === 0) {
      throw new Error("No clipboard text found. Copy text to clipboard, then retry.");
    }
  }

  const transformedText = await transformText({
    instruction: request.instruction,
    sourceText,
    activeApp: context.activeApp,
    mode: promptMode
  });

  // Attempt to insert directly. Fallback to clipboard if it fails (e.g. no accessibility permission).
  const inserted = await insertTextAtCursor(transformedText);
  let fallbackCopiedToClipboard = false;
  if (!inserted) {
    writeClipboardText(transformedText);
    fallbackCopiedToClipboard = true;
  }

  notify(
    "Jarvis",
    inserted ? "Response inserted at cursor." : "Insert failed. Response copied to clipboard."
  );

  return {
    context,
    sourceText,
    transformedText,
    inserted,
    fallbackCopiedToClipboard
  };
}

/**
 * Orchestrates the image transformation flow:
 * 1. Verify an image exists in the clipboard.
 * 2. Send image and instructions to OpenAI DALL-E (edits).
 * 3. Put the result back in the clipboard and notify the user.
 */
export async function runImageTask(request: ImageTaskRequest): Promise<ImageTaskResult> {
  const context = await captureContextSnapshot({ persistClipboardImage: true });
  if (context.clipboard.kind !== "image" || !context.clipboard.imagePath) {
    throw new Error("No clipboard image found. Copy an image to clipboard, then retry.");
  }

  const outputBuffer = await transformClipboardImage({
    imagePath: context.clipboard.imagePath,
    instruction: request.instruction
  });

  const image = createImageFromBuffer(outputBuffer);
  writeClipboardImage(image);

  await ensureOutputDir();
  const outputImagePath = join(getOutputDir(), `image-output-${Date.now()}-${randomUUID()}.png`);
  await writeFile(outputImagePath, outputBuffer);

  notify("Jarvis", "Image ready to paste.");

  return {
    context,
    outputImagePath
  };
}
