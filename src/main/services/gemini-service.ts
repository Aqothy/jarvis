import { GoogleGenAI } from "@google/genai";
import type { Tool } from "@google/genai";
import type { ActiveAppContext } from "../types";

type TextPromptMode = "clipboard_rewrite" | "direct_query";

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

export async function transformText(params: {
  instruction: string;
  sourceText?: string;
  activeApp: ActiveAppContext;
  mode: TextPromptMode;
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiTextModel();
  const baseSystemPrompt =
    "You are Jarvis, a virtual assistant that works anywhere. Be concise and helpful. The active app and window title may provide useful context, but do not reference them directly in the output.";
  const searchPolicy =
    "Use Google Search only when the user request needs fresh/external facts or you are uncertain.";
  const systemPrompt =
    params.mode === "clipboard_rewrite"
      ? `${baseSystemPrompt} You are editing or transforming user-provided clipboard text. Ground the response in that source text. If the request is a pure rewrite/transform of the provided clipboard text, do not use search.`
      : `${baseSystemPrompt} Answer the user's instruction directly. ${searchPolicy}`;

  const userPrompt =
    params.mode === "clipboard_rewrite"
      ? [
          `Instruction: ${params.instruction}`,
          `Active app: ${params.activeApp.name}`,
          `Window title: ${params.activeApp.windowTitle}`,
          "",
          "Clipboard text:",
          params.sourceText ?? "",
        ].join("\n")
      : [
          `Instruction: ${params.instruction}`,
          `Active app: ${params.activeApp.name}`,
          `Window title: ${params.activeApp.windowTitle}`,
        ].join("\n");

  /**
   * We use a low temperature (0.2) to ensure high consistency and accuracy in the rewrite.
   * High maxOutputTokens allows for longer document transformations if needed.
   */
  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      tools: getGeminiTools(),
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
