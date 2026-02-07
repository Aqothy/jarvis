import { GoogleGenAI } from "@google/genai";
import type { ActiveAppContext } from "../types";
import { AppToneService } from "./app-tone-service";

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

  // Get tone profile based on active application
  const toneProfile = AppToneService.getToneProfile(
    params.activeApp.name,
    params.activeApp.windowTitle
  );

  // Log tone detection for debugging
  const rationale = AppToneService.getToneRationale(
    params.activeApp.name,
    params.activeApp.windowTitle
  );
  console.log(`[Tone Detection] Using "${toneProfile.name}" tone: ${rationale}`);

  // Build system prompt with tone-specific guidance
  const systemPrompt = [
    "You rewrite clipboard text for desktop workflows. Fulfill the user's prompt based on the instruction and source text.",
    "The active app and window title may provide useful context for rewriting the text, but do not reference them directly in the output.",
    "",
    `TONE GUIDANCE: ${toneProfile.systemPromptHint}`,
  ].join("\n");

  const userPrompt = [
    `Instruction: ${params.instruction}`,
    `Active app: ${params.activeApp.name}`,
    `Window title: ${params.activeApp.windowTitle}`,
    "",
    "Clipboard text:",
    params.sourceText,
  ].join("\n");

  /**
   * Temperature is adjusted based on the detected tone:
   * - Technical: 0.1 (very consistent, precise)
   * - Formal: 0.2 (consistent, professional)
   * - Neutral: 0.3 (balanced)
   * - Casual: 0.4 (more natural, conversational)
   * - Creative: 0.6 (more varied, expressive)
   */
  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2048,
      candidateCount: 1,
      temperature: toneProfile.temperature,
    },
  });

  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (text.length === 0) {
    throw new Error("Gemini text transform returned empty content.");
  }

  return text;
}
