import { GoogleGenAI } from "@google/genai";
import type { ActiveAppContext } from "../types";

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

export async function transformText(params: {
  instruction: string;
  sourceText: string;
  activeApp: ActiveAppContext;
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiTextModel();
  const systemPrompt =
    "You rewrite clipboard text for desktop workflows. fulfill the user's prompt based on the instruction and source text. The active app and window title may provide useful context for rewriting the text, but do not reference them directly in the output.";
  const userPrompt = [
    `Instruction: ${params.instruction}`,
    `Active app: ${params.activeApp.name}`,
    `Window title: ${params.activeApp.windowTitle}`,
    "",
    "Clipboard text:",
    params.sourceText,
  ].join("\n");

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2048,
      candidateCount: 1,
      temperature: 0.2
    }
  });

  if (typeof response.text === "string" && response.text.trim().length > 0) {
    return response.text.trim();
  }

  throw new Error("Gemini text transform returned empty content.");
}
