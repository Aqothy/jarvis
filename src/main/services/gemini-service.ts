import { GoogleGenAI, Type } from "@google/genai";
import type { Tool } from "@google/genai";
import type { ActiveAppContext, TextPromptMode } from "../types";
import { AppToneService } from "./app-tone-service";
import { WeatherService } from "./weather-service";

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
    {
      functionDeclarations: [
        {
          name: "get_weather",
          description:
            "Get current weather conditions and forecast for any location worldwide. Returns temperature (in Celsius), condition, high/low for the day. If no location is provided, uses the user's current location based on their IP address. Supports locations in Canada, USA, and all countries globally.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              location: {
                type: Type.STRING,
                description:
                  "City name, ZIP/postal code, or coordinates. Supports worldwide locations. Examples: 'Toronto', 'Vancouver, Canada', 'Paris, France', 'M5V 3A8' (Toronto postal code), '43.65,-79.38' (coordinates). Leave empty to use current location.",
              },
              use_celsius: {
                type: Type.BOOLEAN,
                description: "Whether to return temperatures in Celsius. Default is true.",
              },
            },
            required: [],
          },
        },
      ],
    },
  ];
}

/**
 * Execute a function call from Gemini
 */
async function executeFunctionCall(
  functionName: string,
  args: Record<string, unknown>
): Promise<string> {
  console.log(`[Function Call] Executing ${functionName} with args:`, args);

  if (functionName === "get_weather") {
    const location = args.location as string | undefined;
    const useCelsius = (args.use_celsius as boolean) ?? true;

    try {
      const weather = location
        ? await WeatherService.getWeather(location, useCelsius)
        : await WeatherService.getWeatherForCurrentLocation(useCelsius);

      return WeatherService.formatWeather(weather, useCelsius);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      return `Error getting weather: ${errorMessage}`;
    }
  }

  return `Unknown function: ${functionName}`;
}

export async function transformText(params: {
  instruction: string;
  sourceText?: string;
  activeApp: ActiveAppContext;
  mode: TextPromptMode;
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiTextModel();

  // Get tone profile based on active application
  const toneProfile = AppToneService.getToneProfile(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );

  // Log tone detection for debugging
  const rationale = AppToneService.getToneRationale(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );
  console.log(
    `[Tone Detection] Using "${toneProfile.name}" tone (${rationale})`,
  );

  const baseSystemPrompt =
    "You are Jarvis, a virtual assistant that works anywhere. Be concise and helpful. The active app and window title may provide useful context, but do not reference them directly in the output.";
  const searchPolicy =
    "Use Google Search only when the user request needs fresh/external facts or you are uncertain.";

  // Add tone guidance to system prompts
  const toneGuidance = `\n\nTONE: ${toneProfile.systemPromptHint}`;

  const systemPromptByMode: Record<TextPromptMode, string> = {
    clipboard_rewrite: `${baseSystemPrompt} You are editing or transforming user-provided clipboard text. Ground the response in that source text. If the request is a pure rewrite/transform of the provided clipboard text, do not use search.${toneGuidance}`,
    clipboard_explain: `${baseSystemPrompt} You are explaining user-provided clipboard text. Ground the response in that source text first. ${searchPolicy}`,
    direct_query: `${baseSystemPrompt} Answer the user's instruction directly. ${searchPolicy}`,
    dictation_cleanup: `${baseSystemPrompt} The user input is spoken dictation intended to be sent as final text. Rewrite it as the final intended message by removing self-corrections, false starts, and filler while preserving intent.${toneGuidance} Return only the final message text.`,
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

  const userPrompt = userPromptByMode[params.mode];

  /**
   * Temperature is adjusted based on the detected tone:
   * - Technical: 0.1 (very consistent, precise)
   * - Formal: 0.2 (consistent, professional)
   * - Neutral: 0.3 (balanced)
   * - Casual: 0.4 (more natural, conversational)
   * - Creative: 0.6 (more varied, expressive)
   *
   * High maxOutputTokens allows for longer document transformations if needed.
   */
  let response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      tools: getGeminiTools(),
      maxOutputTokens: 2048,
      candidateCount: 1,
      temperature: toneProfile.temperature,
    },
  });

  // Handle function calls if the model wants to use them
  if (response.functionCalls && response.functionCalls.length > 0) {
    console.log("[Function Calling] Model requested function calls");

    // Execute all function calls
    const functionResults = await Promise.all(
      response.functionCalls.map(async (call) => {
        const result = await executeFunctionCall(call.name || "unknown", call.args || {});
        return {
          name: call.name || "unknown",
          response: { result },
        };
      })
    );

    // Send function results back to the model
    response = await client.models.generateContent({
      model,
      contents: [
        { role: "user", parts: [{ text: userPrompt }] },
        { role: "model", parts: response.functionCalls.map((fc) => ({ functionCall: fc })) },
        { role: "user", parts: functionResults.map((fr) => ({ functionResponse: fr })) },
      ],
      config: {
        systemInstruction: systemPrompt,
        tools: getGeminiTools(),
        maxOutputTokens: 2048,
        candidateCount: 1,
        temperature: toneProfile.temperature,
      },
    });
  }

  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (text.length === 0) {
    throw new Error("Gemini text transform returned empty content.");
  }

  return text;
}
