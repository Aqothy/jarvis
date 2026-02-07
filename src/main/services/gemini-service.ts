import { GoogleGenAI } from "@google/genai";
import type { Tool } from "@google/genai";
import type { ActiveAppContext, MemoryKind, TextPromptMode } from "../types";

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment before running text tasks.",
    );
  }
  return apiKey;
}

function getGeminiTextModel(): string {
  return process.env.GEMINI_TEXT_MODEL || "gemini-3-flash";
}

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return cachedClient;
}

function getGeminiTools(): Tool[] {
  return [
    {
      googleSearch: {},
    },
  ];
}

function shouldAttachSearchTool(mode: TextPromptMode): boolean {
  return mode === "direct_query" || mode === "clipboard_explain";
}

function isMemoryKind(value: string): value is MemoryKind {
  return (
    value === "preference" ||
    value === "profile" ||
    value === "workflow" ||
    value === "project" ||
    value === "contact" ||
    value === "other"
  );
}

interface MemoryCleaningResult {
  shouldSave: boolean;
  cleanedMemory: string;
  kind: MemoryKind;
}

function parseMemoryCleaningResult(rawText: string): MemoryCleaningResult {
  const fallback: MemoryCleaningResult = {
    shouldSave: false,
    cleanedMemory: "",
    kind: "other",
  };

  try {
    const parsed = JSON.parse(rawText) as {
      shouldSave?: boolean;
      cleanedMemory?: string;
      kind?: string;
    };

    const cleanedMemory =
      typeof parsed.cleanedMemory === "string"
        ? parsed.cleanedMemory.trim()
        : "";
    const kind =
      typeof parsed.kind === "string" && isMemoryKind(parsed.kind)
        ? parsed.kind
        : "other";
    const shouldSave = parsed.shouldSave === true && cleanedMemory.length > 0;

    return {
      shouldSave,
      cleanedMemory,
      kind,
    };
  } catch {
    return fallback;
  }
}

export async function cleanMemoryCandidate(params: {
  instruction: string;
  candidate: string;
  activeApp: ActiveAppContext;
}): Promise<MemoryCleaningResult> {
  const client = getGeminiClient();
  const model = getGeminiTextModel();

  const systemPrompt =
    "You normalize memory entries for a personal assistant. Extract only stable, useful facts worth saving as long-term memory. Remove fillers, partial phrases, and assistant command text. If the memory candidate is incomplete, ambiguous, or not worth saving, set shouldSave to false. Return strict JSON only with keys: shouldSave (boolean), cleanedMemory (string), kind (one of: preference, profile, workflow, project, contact, other).";
  const userPrompt = [
    `Instruction transcript: ${params.instruction}`,
    `Memory candidate: ${params.candidate}`,
    `Active app: ${params.activeApp.name}`,
    `Window title: ${params.activeApp.windowTitle}`,
  ].join("\n");

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      maxOutputTokens: 256,
      candidateCount: 1,
    },
  });

  const rawText = typeof response.text === "string" ? response.text.trim() : "";
  if (rawText.length === 0) {
    return {
      shouldSave: false,
      cleanedMemory: "",
      kind: "other",
    };
  }

  return parseMemoryCleaningResult(rawText);
}

export async function transformText(params: {
  instruction: string;
  sourceText?: string;
  activeApp: ActiveAppContext;
  mode: TextPromptMode;
  memoryContext?: string[];
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiTextModel();
  const hasMemoryContext =
    Array.isArray(params.memoryContext) && params.memoryContext.length > 0;
  const baseSystemPrompt =
    "You are Jarvis, a virtual assistant that works anywhere. Be concise and helpful. The active app and window title may provide useful context, but do not reference them directly in the output.";
  const searchPolicy =
    "Use Google Search only when the request needs fresh or external facts that are not already available in provided text or saved memory.";
  const memoryPolicy = hasMemoryContext
    ? "Saved user memory may be included in the prompt. Treat those memory entries as trusted user-provided facts. If the question can be answered from saved memory, answer directly from it and do not claim you lack access to personal information."
    : "No saved user memory is available in this request.";
  const systemPromptByMode: Record<TextPromptMode, string> = {
    clipboard_rewrite: `${baseSystemPrompt} ${memoryPolicy} You are editing or transforming user-provided clipboard text. Ground the response in that source text. If the request is a pure rewrite/transform of the provided clipboard text, do not use search.`,
    clipboard_explain: `${baseSystemPrompt} ${memoryPolicy} You are explaining user-provided clipboard text. Ground the response in that source text first. ${searchPolicy}`,
    direct_query: `${baseSystemPrompt} ${memoryPolicy} Answer the user's instruction directly. Prefer saved memory when relevant to personal questions. ${searchPolicy}`,
    dictation_cleanup: `${baseSystemPrompt} The user input is spoken dictation intended to be sent as final text. Rewrite it as the final intended message by removing self-corrections, false starts, and filler while preserving intent. Keep tone casual unless asked otherwise. Return only the final message text.`,
  };

  const systemPrompt = systemPromptByMode[params.mode];

  const contextualHeader = [
    `Instruction: ${params.instruction}`,
    `Active app: ${params.activeApp.name}`,
    `Window title: ${params.activeApp.windowTitle}`,
  ];

  const userPromptByMode: Record<TextPromptMode, string> = {
    clipboard_rewrite: [
      ...contextualHeader,
      "",
      "Clipboard text:",
      params.sourceText ?? "",
    ].join("\n"),
    clipboard_explain: [
      ...contextualHeader,
      "",
      "Clipboard text:",
      params.sourceText ?? "",
    ].join("\n"),
    direct_query: contextualHeader.join("\n"),
    dictation_cleanup: contextualHeader.join("\n"),
  };

  const memoryPrompt =
    params.memoryContext && params.memoryContext.length > 0
      ? [
          "",
          "Authoritative saved user memory (use when relevant):",
          ...params.memoryContext.map((memory) => `- ${memory}`),
        ].join("\n")
      : "";
  const userPrompt = `${userPromptByMode[params.mode]}${memoryPrompt}`;

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      tools: shouldAttachSearchTool(params.mode) ? getGeminiTools() : undefined,
      maxOutputTokens: 2048,
      candidateCount: 1,
    },
  });

  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (text.length === 0) {
    throw new Error("Gemini text transform returned empty content.");
  }

  return text;
}
