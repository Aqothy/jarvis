import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { Tool } from "@google/genai";
import { readFile } from "node:fs/promises";
import type {
  ActiveAppContext,
  ClipboardKind,
  TextDeliveryMode,
  TextPromptMode,
} from "../types";
import {
  AppToneService,
  isCodingEnvironmentContext,
} from "./app-tone-service";
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

function getGeminiFastModel(): string {
  return (
    process.env.GEMINI_FAST_MODEL ||
    process.env.GEMINI_TEXT_MODEL ||
    "gemini-2.5-flash-lite"
  );
}

function getGeminiCodingModel(): string {
  return process.env.GEMINI_CODING_MODEL || "gemini-3-flash";
}

function getGeminiRouterModel(): string {
  return process.env.GEMINI_ROUTER_MODEL || "gemini-2.5-flash-lite";
}

function getGeminiDictationModel(): string {
  return process.env.GEMINI_DICTATION_MODEL || "gemini-2.5-flash-lite";
}

function getGeminiImageExplainModel(): string {
  return process.env.GEMINI_IMAGE_EXPLAIN_MODEL || "gemini-3-flash";
}

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return cachedClient;
}

function getGeminiSearchTools(): Tool[] {
  return [
    {
      googleSearch: {},
    },
  ];
}

function shouldAttachSearchTool(mode: TextPromptMode): boolean {
  return mode === "direct_query" || mode === "clipboard_explain";
}

function isUnsupportedToolConfigError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("tool use") ||
    message.includes("function calling") ||
    message.includes("unsupported")
  );
}

interface WeatherFunctionArgs {
  location?: string;
  use_celsius?: boolean;
}

interface WebsiteReadFunctionArgs {
  url?: string;
  summary_style?: "brief" | "detailed";
}

export type TaskRouterRoute =
  | "text_task"
  | "image_edit"
  | "image_generate"
  | "image_explain"
  | "weather_query"
  | "webpage_read"
  | "background_remove";

interface TaskRouterRawResponse {
  route?: string;
  textMode?: string;
  deliveryMode?: string;
  rewrittenInstruction?: string;
}

export interface TaskRouterDecision {
  route: TaskRouterRoute;
  textMode: TextPromptMode;
  deliveryMode: TextDeliveryMode;
  rewrittenInstruction: string;
}

function getDefaultDeliveryModeForRoute(route: TaskRouterRoute): TextDeliveryMode {
  if (
    route === "image_edit" ||
    route === "image_generate" ||
    route === "background_remove"
  ) {
    return "none";
  }
  return "clipboard";
}

function normalizeDeliveryModeForRoute(
  route: TaskRouterRoute,
  requestedMode: TextDeliveryMode,
): TextDeliveryMode {
  if (route === "webpage_read") {
    return "clipboard";
  }

  if (
    requestedMode === "none" &&
    (route === "text_task" ||
      route === "weather_query" ||
      route === "image_explain")
  ) {
    return "clipboard";
  }
  return requestedMode;
}

function isTaskRouterRoute(value: string): value is TaskRouterRoute {
  return (
    value === "text_task" ||
    value === "image_edit" ||
    value === "image_generate" ||
    value === "image_explain" ||
    value === "weather_query" ||
    value === "webpage_read" ||
    value === "background_remove"
  );
}

function extractFirstHttpUrl(input: string): string | undefined {
  const match = input.match(/https?:\/\/[^\s<>"']+/i);
  if (!match || !match[0]) {
    return undefined;
  }

  const candidate = match[0].trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildActiveAppPromptLines(activeApp: ActiveAppContext): string[] {
  return [
    `Active app: ${activeApp.name}`,
    `Window title: ${activeApp.windowTitle}`,
  ];
}

function isTextPromptMode(value: string): value is TextPromptMode {
  return (
    value === "clipboard_rewrite" ||
    value === "clipboard_explain" ||
    value === "direct_query" ||
    value === "dictation_cleanup"
  );
}

function isTextDeliveryMode(value: string): value is TextDeliveryMode {
  return (
    value === "insert" ||
    value === "clipboard" ||
    value === "none" ||
    value === "tts"
  );
}

function parseTaskRouterDecision(
  rawText: string,
  fallbackInstruction: string,
): TaskRouterDecision {
  try {
    const parsed = JSON.parse(rawText) as TaskRouterRawResponse;
    const route =
      typeof parsed.route === "string" && isTaskRouterRoute(parsed.route)
        ? parsed.route
        : "text_task";
    const textMode =
      typeof parsed.textMode === "string" && isTextPromptMode(parsed.textMode)
        ? parsed.textMode
        : "direct_query";
    const deliveryMode =
      typeof parsed.deliveryMode === "string" &&
      isTextDeliveryMode(parsed.deliveryMode)
        ? normalizeDeliveryModeForRoute(route, parsed.deliveryMode)
        : getDefaultDeliveryModeForRoute(route);
    const rewrittenInstruction =
      typeof parsed.rewrittenInstruction === "string" &&
      parsed.rewrittenInstruction.trim().length > 0
        ? parsed.rewrittenInstruction.trim()
        : fallbackInstruction.trim();

    return {
      route,
      textMode,
      deliveryMode,
      rewrittenInstruction,
    };
  } catch {
    return {
      route: "text_task",
      textMode: "direct_query",
      deliveryMode: "clipboard",
      rewrittenInstruction: fallbackInstruction.trim(),
    };
  }
}

export async function routeTextTask(params: {
  instruction: string;
  clipboardKind: ClipboardKind;
  clipboardTextPreview: string;
  activeApp: ActiveAppContext;
}): Promise<TaskRouterDecision> {
  const client = getGeminiClient();
  const model = getGeminiRouterModel();

  const systemPrompt =
    "You are a fast routing model for a desktop assistant. Return strict JSON only with keys: route, textMode, deliveryMode, rewrittenInstruction. route must be one of: text_task, image_edit, image_generate, image_explain, weather_query, webpage_read, background_remove. textMode must be one of: clipboard_rewrite, clipboard_explain, direct_query, dictation_cleanup. deliveryMode must be one of: insert, clipboard, none. Rules: 1) Use transcript + clipboard kind together. 2) Never choose image_edit, image_explain, or background_remove unless clipboard kind is image. 3) If user asks to edit/transform an existing image, choose image_edit and deliveryMode none. 4) If user asks to generate/create a new image (icon, logo, art, illustration, etc.), choose image_generate and deliveryMode none. 5) If user asks to explain/describe/analyze the current image, choose image_explain. 6) If user asks weather/forecast/temperature/rain/snow, choose weather_query. 7) If user asks to read, summarize, or explain the content of the current website/page/tab, choose webpage_read and deliveryMode clipboard. 8) If user asks to remove/delete/cut/erase the background from an image (e.g., 'remove background', 'transparent background'), choose background_remove and deliveryMode none. 9) For normal text requests choose text_task and set textMode+deliveryMode appropriately. Keep rewrittenInstruction concise and faithful to intent.";
  const userPrompt = [
    `Instruction transcript: ${params.instruction}`,
    `Clipboard kind: ${params.clipboardKind}`,
    `Clipboard text preview: ${params.clipboardTextPreview}`,
    ...buildActiveAppPromptLines(params.activeApp),
  ].join("\n");

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      maxOutputTokens: 220,
      candidateCount: 1,
      temperature: 0,
    },
  });

  const rawText = typeof response.text === "string" ? response.text.trim() : "";
  return parseTaskRouterDecision(rawText, params.instruction);
}

export async function transformText(params: {
  instruction: string;
  sourceText?: string;
  activeApp: ActiveAppContext;
  mode: TextPromptMode;
  memoryContext?: string[];
}): Promise<string> {
  const client = getGeminiClient();
  const codingEnvironment = isCodingEnvironmentContext(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );
  const useCodingModel =
    codingEnvironment && params.mode !== "dictation_cleanup";
  const model =
    params.mode === "dictation_cleanup"
      ? getGeminiDictationModel()
      : useCodingModel
        ? getGeminiCodingModel()
        : getGeminiFastModel();
  const toneProfile = AppToneService.getToneProfile(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );
  const rationale = AppToneService.getToneRationale(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );
  console.log(
    `[Coding Environment Detection] app="${params.activeApp.name}" window="${params.activeApp.windowTitle}" codingEnvironment=${codingEnvironment}`,
  );
  console.log(
    `[Tone Detection] Using "${toneProfile.name}" tone (${rationale})`,
  );
  console.log(
    `[Model Selection] model="${model}" useCodingModel=${useCodingModel} codingEnvironment=${codingEnvironment} mode="${params.mode}"`,
  );

  const hasMemoryContext =
    Array.isArray(params.memoryContext) && params.memoryContext.length > 0;
  const baseGeneralSystemPrompt =
    "You are Jarvis, a virtual assistant that works anywhere. Be concise and helpful. Keep responses short by default and only add extra detail when the user asks. The active app and window title may provide useful context, but do not reference them directly in the output. For code, shell commands, or config snippets, output plain text only. Do not use markdown code fences or triple backticks unless the user explicitly asks for markdown formatting.";
  const baseCodingSystemPrompt =
    "You are Jarvis, an expert coding assistant running in a coding environment. Prioritize correctness and practical implementation details. Provide production-ready code, shell commands, and configuration with clear defaults. Keep explanations concise and focused on what to change and why. Return plain text only and never use markdown code fences or triple backticks unless explicitly requested.";
  const codingOutputPolicy = useCodingModel
    ? "Output contract: return only the final code/config/command content. Do not include prose before or after the output. If explanation is necessary, include it only as code comments within the output."
    : "";
  const baseSystemPrompt = useCodingModel
    ? `${baseCodingSystemPrompt} ${codingOutputPolicy}`
    : baseGeneralSystemPrompt;
  const searchPolicy =
    "Use Google Search only when the request needs fresh or external facts that are not already available in provided text or saved memory.";
  const memoryPolicy = hasMemoryContext
    ? "Saved user memory may be included in the prompt. Treat those memory entries as trusted user-provided facts. If the question can be answered from saved memory, answer directly from it and do not claim you lack access to personal information. Memory lines can be phrased in first person; when responding to the user, rewrite them in second person (for example, 'Your name is Anthony.')."
    : "No saved user memory is available in this request.";
  const tonePolicy = `Tone hint: ${toneProfile.systemPromptHint}`;
  const systemPromptByMode: Record<TextPromptMode, string> = {
    clipboard_rewrite: `${baseSystemPrompt} ${memoryPolicy} ${tonePolicy} You are editing or transforming user-provided clipboard text. Ground the response in that source text. Return only the transformed final text. If the request is a pure rewrite/transform of the provided clipboard text, do not use search.`,
    clipboard_explain: `${baseSystemPrompt} ${memoryPolicy} ${tonePolicy} You are explaining user-provided clipboard text. Ground the response in that source text first. ${searchPolicy}`,
    direct_query: `${baseSystemPrompt} ${memoryPolicy} ${tonePolicy} Answer the user's instruction directly with concise, practical output. Prefer saved memory when relevant to personal questions. If drafting an email or message and saved memory includes the user's name, use the real name in the sign-off and never use placeholders like [example name] or [your name]. ${searchPolicy}`,
    dictation_cleanup: `${baseSystemPrompt} ${tonePolicy} The user input is spoken dictation intended to be sent as final text. Rewrite it as the final intended message by removing self-corrections, false starts, and filler while preserving intent. Keep tone casual unless asked otherwise. Return only the final message text.`,
  };

  const systemPrompt = systemPromptByMode[params.mode];

  const contextualHeader = [
    `Instruction: ${params.instruction}`,
    ...buildActiveAppPromptLines(params.activeApp),
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
          params.memoryContext.join("\n"),
        ].join("\n")
      : "";
  const userPrompt = `${userPromptByMode[params.mode]}${memoryPrompt}`;
  const tools = shouldAttachSearchTool(params.mode)
    ? getGeminiSearchTools()
    : undefined;

  let response: Awaited<ReturnType<typeof client.models.generateContent>>;
  try {
    response = await client.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        tools,
        maxOutputTokens: 2048,
        candidateCount: 1,
        temperature: toneProfile.temperature,
      },
    });
  } catch (error) {
    if (!tools || !isUnsupportedToolConfigError(error)) {
      throw error;
    }
    response = await client.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
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

export async function transformImageToText(params: {
  instruction: string;
  imagePath: string;
  activeApp: ActiveAppContext;
  memoryContext?: string[];
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiImageExplainModel();
  const toneProfile = AppToneService.getToneProfile(
    params.activeApp.name,
    params.activeApp.windowTitle,
  );

  const hasMemoryContext =
    Array.isArray(params.memoryContext) && params.memoryContext.length > 0;
  const memoryPolicy = hasMemoryContext
    ? "Saved user memory may be included in the prompt. Treat those entries as trusted user-provided facts when relevant."
    : "No saved user memory is available in this request.";
  const systemPrompt = [
    "You are Jarvis, a virtual assistant that works anywhere.",
    "Use the provided image and instruction to answer accurately and concisely.",
    "If asked to explain, describe, or analyze the image, focus on visible details only.",
    `Tone hint: ${toneProfile.systemPromptHint}`,
    memoryPolicy,
  ].join(" ");

  const memoryPrompt =
    params.memoryContext && params.memoryContext.length > 0
      ? [
          "",
          "Authoritative saved user memory (use when relevant):",
          params.memoryContext.join("\n"),
        ].join("\n")
      : "";
  const textPrompt = [
    `Instruction: ${params.instruction}`,
    ...buildActiveAppPromptLines(params.activeApp),
    memoryPrompt,
  ].join("\n");

  const imageBuffer = await readFile(params.imagePath);
  const response = await client.models.generateContent({
    model,
    contents: [
      { text: textPrompt },
      {
        inlineData: {
          mimeType: "image/png",
          data: imageBuffer.toString("base64"),
        },
      },
    ],
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2048,
      candidateCount: 1,
      temperature: toneProfile.temperature,
    },
  });

  const text = typeof response.text === "string" ? response.text.trim() : "";
  if (text.length === 0) {
    throw new Error("Gemini image interpretation returned empty content.");
  }
  return text;
}

export async function runWeatherFunctionCall(params: {
  instruction: string;
  activeApp: ActiveAppContext;
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiFastModel();

  const response = await client.models.generateContent({
    model,
    contents: [
      `Instruction: ${params.instruction}`,
      ...buildActiveAppPromptLines(params.activeApp),
    ].join("\n"),
    config: {
      systemInstruction:
        "You are Jarvis. For weather requests, call get_weather exactly once to retrieve weather data. Do not answer without calling the function.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_weather",
              description:
                "Get current weather conditions and forecast for any location worldwide. Returns current temperature, condition, and high/low for the day.",
              parametersJsonSchema: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description:
                      "City name, ZIP/postal code, or coordinates. Leave empty to use current location by IP.",
                  },
                  use_celsius: {
                    type: "boolean",
                    description:
                      "Whether to return temperatures in Celsius. Default is true.",
                  },
                },
                additionalProperties: false,
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["get_weather"],
        },
      },
      maxOutputTokens: 256,
      candidateCount: 1,
    },
  });

  const functionCall = response.functionCalls?.[0];
  if (!functionCall || functionCall.name !== "get_weather") {
    throw new Error("Weather function call was not produced by the model.");
  }

  const functionArgs = (functionCall.args ?? {}) as WeatherFunctionArgs;
  const location =
    typeof functionArgs.location === "string"
      ? functionArgs.location.trim()
      : undefined;
  const useCelsius =
    typeof functionArgs.use_celsius === "boolean"
      ? functionArgs.use_celsius
      : true;

  const weather = location
    ? await WeatherService.getWeather(location, useCelsius)
    : await WeatherService.getWeatherForCurrentLocation(useCelsius);

  return WeatherService.formatWeather(weather, useCelsius);
}

export async function runWebsiteReadFunctionCall(params: {
  instruction: string;
  activeApp: ActiveAppContext;
  clipboardText: string;
}): Promise<string> {
  const client = getGeminiClient();
  const model = getGeminiFastModel();

  const response = await client.models.generateContent({
    model,
    contents: [
      `Instruction: ${params.instruction}`,
      ...buildActiveAppPromptLines(params.activeApp),
    ].join("\n"),
    config: {
      systemInstruction:
        "You are Jarvis. For requests that involve reading or summarizing website content, call get_readable_website_content exactly once. If no URL is explicitly provided in the instruction, leave it empty so the app can use the clipboard URL.",
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_readable_website_content",
              description:
                "Fetch and extract readable text from a webpage for read-aloud and summarization.",
              parametersJsonSchema: {
                type: "object",
                properties: {
                  url: {
                    type: "string",
                    description:
                      "Optional webpage URL. Leave empty to use the clipboard URL.",
                  },
                  summary_style: {
                    type: "string",
                    enum: ["brief", "detailed"],
                    description:
                      "How detailed the summary should be. Use brief by default.",
                  },
                },
                additionalProperties: false,
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["get_readable_website_content"],
        },
      },
      maxOutputTokens: 256,
      candidateCount: 1,
      temperature: 0,
    },
  });

  const functionCall = response.functionCalls?.[0];
  if (
    !functionCall ||
    functionCall.name !== "get_readable_website_content"
  ) {
    throw new Error("Website function call was not produced by the model.");
  }

  const functionArgs = (functionCall.args ?? {}) as WebsiteReadFunctionArgs;
  const requestedUrl =
    typeof functionArgs.url === "string" ? functionArgs.url.trim() : "";
  const clipboardUrl = extractFirstHttpUrl(params.clipboardText);
  const resolvedUrl =
    requestedUrl.length > 0 ? requestedUrl : clipboardUrl ?? "";

  if (resolvedUrl.trim().length === 0) {
    throw new Error(
      "No website URL was available. Copy a website URL to clipboard and try again.",
    );
  }

  const summaryStyle = functionArgs.summary_style === "detailed"
    ? "detailed"
    : "brief";
  const summarySystemPrompt =
    summaryStyle === "detailed"
      ? "Read and summarize the content of the provided website URL. Use Google Search tool when needed to fetch the page content and produce a clear, spoken-friendly summary with important details. Return plain text only."
      : "Read and summarize the content of the provided website URL. Use Google Search tool when needed to fetch the page content and produce a concise, spoken-friendly summary. Return plain text only.";

  const summaryResponse = await client.models.generateContent({
    model,
    contents: [
      `Instruction: ${params.instruction}`,
      `Website URL: ${resolvedUrl}`,
      ...buildActiveAppPromptLines(params.activeApp),
    ].join("\n"),
    config: {
      systemInstruction: summarySystemPrompt,
      tools: getGeminiSearchTools(),
      maxOutputTokens: 1200,
      candidateCount: 1,
      temperature: 0.2,
    },
  });

  const summaryText =
    typeof summaryResponse.text === "string" ? summaryResponse.text.trim() : "";
  if (summaryText.length === 0) {
    throw new Error("Website summary generation returned empty content.");
  }

  return [
    `Website: ${resolvedUrl}`,
    "",
    summaryText,
  ].join("\n");
}
