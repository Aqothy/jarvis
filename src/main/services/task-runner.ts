import { Notification, app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ImageTaskRequest,
  ImageTaskResult,
  SpeechProvider,
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
import { getMemoryPromptContext } from "./memory-service";
import { transformClipboardImage } from "./gemini-image-service";
import {
  routeTextTask,
  runWeatherFunctionCall,
  runWebsiteReadFunctionCall,
  type TaskRouterRoute,
  transformImageToText,
  transformText,
} from "./gemini-service";
import { synthesizeAndPlay } from "./gradium-stt-service";
import { WeatherService } from "./weather-service";
import { ElevenLabsTtsService } from "./elevenlabs-tts-service";
import { removeBackground } from "./background-removal-service";
import { getTtsEnabled, getTtsProvider } from "./tts-state-service";

interface WeatherQuery {
  location?: string;
  useCelsius: boolean;
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

function truncateForNotification(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

function parseWeatherQuery(instruction: string): WeatherQuery {
  let useCelsius = true;
  if (/\b(fahrenheit|°f)\b/i.test(instruction)) {
    useCelsius = false;
  } else if (/\b(celsius|centigrade|°c)\b/i.test(instruction)) {
    useCelsius = true;
  }

  const locationMatch = /\b(?:in|for|at)\s+(.+?)(?:\s+(?:today|tonight|tomorrow|now|right now|currently)\b|[?!.,]|$)/i.exec(
    instruction,
  );
  const rawLocation =
    locationMatch && typeof locationMatch[1] === "string"
      ? locationMatch[1].trim()
      : "";
  const location = rawLocation.replace(/\bplease\b$/i, "").trim();

  return {
    location: location.length > 0 ? location : undefined,
    useCelsius,
  };
}

function requiresClipboardTextForMode(mode: TextPromptMode): boolean {
  return mode === "clipboard_rewrite" || mode === "clipboard_explain";
}

async function deliverTextOutput(params: {
  transformedText: string;
  deliveryMode: TextDeliveryMode;
  ttsEnabled: boolean;
  ttsProvider: SpeechProvider;
}): Promise<{
  inserted: boolean;
  copiedToClipboard: boolean;
  fallbackCopiedToClipboard: boolean;
  spokenByTts: boolean;
  ttsPlaybackError?: string;
}> {
  const speakWithProvider = async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    try {
      if (params.ttsProvider === "elevenlabs") {
        const ttsResult = await ElevenLabsTtsService.readAloud({
          text: params.transformedText,
        });
        return {
          success: ttsResult.success,
          error: ttsResult.error,
        };
      }

      await synthesizeAndPlay(params.transformedText);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "TTS playback failed.",
      };
    }
  };

  const deliverAsClipboardOrTts = async (): Promise<{
    inserted: boolean;
    copiedToClipboard: boolean;
    fallbackCopiedToClipboard: boolean;
    spokenByTts: boolean;
    ttsPlaybackError?: string;
  }> => {
    if (params.ttsEnabled) {
      const ttsResult = await speakWithProvider();
      if (ttsResult.success) {
        notify("Jarvis", "Response spoken.");
        return {
          inserted: false,
          copiedToClipboard: false,
          fallbackCopiedToClipboard: false,
          spokenByTts: true,
        };
      }

      const errorMessage = ttsResult.error || "TTS playback failed.";
      writeClipboardText(params.transformedText);
      notify(
        "Jarvis",
        `TTS failed: ${truncateForNotification(errorMessage, 120)}. Response copied to clipboard.`,
      );
      return {
        inserted: false,
        copiedToClipboard: true,
        fallbackCopiedToClipboard: true,
        spokenByTts: false,
        ttsPlaybackError: errorMessage,
      };
    }

    writeClipboardText(params.transformedText);
    notify("Jarvis", "Response copied to clipboard.");
    return {
      inserted: false,
      copiedToClipboard: true,
      fallbackCopiedToClipboard: true,
      spokenByTts: false,
    };
  };

  if (params.deliveryMode === "none") {
    return {
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
      spokenByTts: false,
    };
  }

  if (params.deliveryMode === "tts") {
    notify("Jarvis", "Reading response aloud...");
    const ttsResult = await speakWithProvider();

    if (!ttsResult.success) {
      const errorMessage = ttsResult.error || "TTS playback failed.";
      writeClipboardText(params.transformedText);
      notify(
        "Jarvis",
        `TTS failed: ${truncateForNotification(errorMessage, 120)}. Response copied to clipboard.`,
      );
      return {
        inserted: false,
        copiedToClipboard: true,
        fallbackCopiedToClipboard: true,
        spokenByTts: false,
        ttsPlaybackError: errorMessage,
      };
    }

    return {
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
      spokenByTts: true,
    };
  }

  if (params.deliveryMode === "insert") {
    const inserted = await insertTextAtCursor(params.transformedText);
    if (!inserted) {
      const fallbackResult = await deliverAsClipboardOrTts();
      return fallbackResult;
    }

    return {
      inserted: true,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
      spokenByTts: false,
    };
  }

  return deliverAsClipboardOrTts();
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
  const ttsEnabled = getTtsEnabled();
  const ttsProvider = getTtsProvider();

  if (request.mode === "force_dictation") {
    const context = await captureContextSnapshot({
      persistClipboardImage: false,
      includeClipboard: false,
    });
    const transformedText = await transformText({
      instruction: request.instruction,
      sourceText: "",
      activeApp: context.activeApp,
      mode: "dictation_cleanup",
      memoryContext: [],
    });
    const deliveryResult = await deliverTextOutput({
      transformedText,
      deliveryMode: "insert",
      ttsEnabled,
      ttsProvider,
    });

    return {
      context,
      sourceText: "",
      transformedText,
      promptMode: "dictation_cleanup",
      deliveryMode: "insert",
      inserted: deliveryResult.inserted,
      copiedToClipboard: deliveryResult.copiedToClipboard,
      fallbackCopiedToClipboard: deliveryResult.fallbackCopiedToClipboard,
      spokenByTts: deliveryResult.spokenByTts,
      ttsPlaybackError: deliveryResult.ttsPlaybackError,
    };
  }

  const context = await captureContextSnapshot({
    persistClipboardImage: true,
  });

  let routedInstruction = request.instruction;
  let routerRoute: TaskRouterRoute = "text_task";
  let routerTextMode: TextPromptMode = "direct_query";
  let routerDeliveryMode: TextDeliveryMode = "clipboard";

  const clipboardTextPreview = context.clipboard.text?.text ?? "";
  try {
    const routerDecision = await routeTextTask({
      instruction: request.instruction,
      clipboardKind: context.clipboard.kind,
      clipboardTextPreview,
      activeApp: context.activeApp,
    });
    routerRoute = routerDecision.route;
    routerTextMode = routerDecision.textMode;
    routerDeliveryMode = routerDecision.deliveryMode;
    routedInstruction = routerDecision.rewrittenInstruction;
  } catch {
    routerRoute = "text_task";
    routerTextMode = "direct_query";
    routerDeliveryMode = "clipboard";
    routedInstruction = request.instruction;
  }
  console.log(
    `[Task Routing] route="${routerRoute}" mode="${routerTextMode}" delivery="${routerDeliveryMode}"`,
  );

  if (routerRoute === "weather_query") {
    let transformedText: string;
    try {
      transformedText = await runWeatherFunctionCall({
        instruction: routedInstruction,
        activeApp: context.activeApp,
      });
    } catch (error) {
      console.warn(
        "[Weather Function Calling] Falling back to direct weather service:",
        error,
      );
      const weatherQuery = parseWeatherQuery(request.instruction);
      const weather = weatherQuery.location
        ? await WeatherService.getWeather(
            weatherQuery.location,
            weatherQuery.useCelsius,
          )
        : await WeatherService.getWeatherForCurrentLocation(
            weatherQuery.useCelsius,
          );
      transformedText = WeatherService.formatWeather(
        weather,
        weatherQuery.useCelsius,
      );
    }
    const weatherDeliveryMode =
      routerDeliveryMode === "none" ? "clipboard" : routerDeliveryMode;
    const deliveryResult = await deliverTextOutput({
      transformedText,
      deliveryMode: weatherDeliveryMode,
      ttsEnabled,
      ttsProvider,
    });

    return {
      context,
      sourceText: "",
      transformedText,
      promptMode: "direct_query",
      deliveryMode: weatherDeliveryMode,
      inserted: deliveryResult.inserted,
      copiedToClipboard: deliveryResult.copiedToClipboard,
      fallbackCopiedToClipboard: deliveryResult.fallbackCopiedToClipboard,
      spokenByTts: deliveryResult.spokenByTts,
      ttsPlaybackError: deliveryResult.ttsPlaybackError,
    };
  }

  if (routerRoute === "webpage_read") {
    const transformedText = await runWebsiteReadFunctionCall({
      instruction: routedInstruction,
      activeApp: context.activeApp,
      clipboardText: context.clipboard.text?.text ?? "",
    });
    const webpageDeliveryMode: TextDeliveryMode = "clipboard";
    const deliveryResult = await deliverTextOutput({
      transformedText,
      deliveryMode: webpageDeliveryMode,
      ttsEnabled,
      ttsProvider,
    });

    return {
      context,
      sourceText: "",
      transformedText,
      promptMode: "direct_query",
      deliveryMode: webpageDeliveryMode,
      inserted: deliveryResult.inserted,
      copiedToClipboard: deliveryResult.copiedToClipboard,
      fallbackCopiedToClipboard: deliveryResult.fallbackCopiedToClipboard,
      spokenByTts: deliveryResult.spokenByTts,
      ttsPlaybackError: deliveryResult.ttsPlaybackError,
    };
  }

  if (routerRoute === "image_edit") {
    if (context.clipboard.kind === "image" && context.clipboard.imagePath) {
      const outputBuffer = await transformClipboardImage({
        imagePath: context.clipboard.imagePath,
        instruction: routedInstruction,
      });
      writeClipboardImage(createImageFromBuffer(outputBuffer));
      notify("Jarvis", "Image ready to paste.");

      return {
        context,
        sourceText: "",
        transformedText: "Image edited and copied to clipboard.",
        promptMode: "direct_query",
        deliveryMode: "none",
        inserted: false,
        copiedToClipboard: false,
        fallbackCopiedToClipboard: false,
      };
    }
    routerRoute = "text_task";
  }

  if (routerRoute === "image_generate") {
    const outputBuffer = await transformClipboardImage({
      instruction: routedInstruction,
    });
    writeClipboardImage(createImageFromBuffer(outputBuffer));
    notify("Jarvis", "Generated image ready to paste.");

    return {
      context,
      sourceText: "",
      transformedText: "Image generated and copied to clipboard.",
      promptMode: "direct_query",
      deliveryMode: "none",
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  if (routerRoute === "image_explain") {
    if (context.clipboard.kind === "image" && context.clipboard.imagePath) {
      const memoryContext = getMemoryPromptContext();
      const transformedText = await transformImageToText({
        instruction: routedInstruction,
        imagePath: context.clipboard.imagePath,
        activeApp: context.activeApp,
        memoryContext,
      });

      const imageExplainDeliveryMode =
        routerDeliveryMode === "none" ? "clipboard" : routerDeliveryMode;
      const deliveryResult = await deliverTextOutput({
        transformedText,
        deliveryMode: imageExplainDeliveryMode,
        ttsEnabled,
        ttsProvider,
      });

      return {
        context,
        sourceText: "",
        transformedText,
        promptMode: "direct_query",
        deliveryMode: imageExplainDeliveryMode,
        inserted: deliveryResult.inserted,
        copiedToClipboard: deliveryResult.copiedToClipboard,
        fallbackCopiedToClipboard: deliveryResult.fallbackCopiedToClipboard,
        spokenByTts: deliveryResult.spokenByTts,
        ttsPlaybackError: deliveryResult.ttsPlaybackError,
      };
    }
    routerRoute = "text_task";
  }

  if (routerRoute === "background_remove") {
    if (context.clipboard.kind === "image" && context.clipboard.imagePath) {
      notify("Jarvis", "Removing background...");
      const result = await removeBackground({
        imagePath: context.clipboard.imagePath,
      });

      if (!result.success) {
        const errorMsg = `Failed to remove background: ${result.error}`;
        notify("Jarvis", errorMsg);
        return {
          context,
          sourceText: "",
          transformedText: errorMsg,
          promptMode: "direct_query",
          deliveryMode: "none",
          inserted: false,
          copiedToClipboard: false,
          fallbackCopiedToClipboard: false,
        };
      }

      if (result.imageBuffer) {
        writeClipboardImage(createImageFromBuffer(result.imageBuffer));
        notify("Jarvis", "Background removed. Image ready to paste.");

        return {
          context,
          sourceText: "",
          transformedText: "Background removed and copied to clipboard.",
          promptMode: "direct_query",
          deliveryMode: "none",
          inserted: false,
          copiedToClipboard: false,
          fallbackCopiedToClipboard: false,
        };
      }
    }

    const errorMsg =
      "No image found to remove background. Please copy an image first.";
    notify("Jarvis", errorMsg);
    return {
      context,
      sourceText: "",
      transformedText: errorMsg,
      promptMode: "direct_query",
      deliveryMode: "none",
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  const plan = {
    promptMode: routerTextMode,
    deliveryMode: routerDeliveryMode,
    requiresClipboardText: requiresClipboardTextForMode(routerTextMode),
  };
  let sourceText = "";
  const memoryContext =
    plan.promptMode === "dictation_cleanup"
      ? []
      : getMemoryPromptContext();

  if (plan.requiresClipboardText) {
    sourceText = context.clipboard.text?.text ?? "";
    if (sourceText.trim().length === 0) {
      plan.promptMode = "direct_query";
      plan.deliveryMode = "clipboard";
      plan.requiresClipboardText = false;
    }
  }

  const transformedText = await transformText({
    instruction: routedInstruction,
    sourceText,
    activeApp: context.activeApp,
    mode: plan.promptMode,
    memoryContext,
  });

  const deliveryResult = await deliverTextOutput({
    transformedText,
    deliveryMode: plan.deliveryMode,
    ttsEnabled,
    ttsProvider,
  });

  return {
    context,
    sourceText,
    transformedText,
    promptMode: plan.promptMode,
    deliveryMode: plan.deliveryMode,
    inserted: deliveryResult.inserted,
    copiedToClipboard: deliveryResult.copiedToClipboard,
    fallbackCopiedToClipboard: deliveryResult.fallbackCopiedToClipboard,
    spokenByTts: deliveryResult.spokenByTts,
    ttsPlaybackError: deliveryResult.ttsPlaybackError,
  };
}

/**
 * Orchestrates the image transformation flow:
 * 1. Capture clipboard image if present.
 * 2. Send instruction to Gemini for generation/editing.
 * 3. Put the result back in the clipboard and notify the user.
 */
export async function runImageTask(
  request: ImageTaskRequest,
): Promise<ImageTaskResult> {
  const context = await captureContextSnapshot({ persistClipboardImage: true });
  const imagePath =
    context.clipboard.kind === "image" ? context.clipboard.imagePath : undefined;

  const outputBuffer = await transformClipboardImage({
    instruction: request.instruction,
    imagePath,
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
