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
import { getMemoryPromptContext } from "./memory-service";
import { transformClipboardImage } from "./gemini-image-service";
import {
  routeTextTask,
  runWeatherFunctionCall,
  type TaskRouterRoute,
  transformImageToText,
  transformText,
} from "./gemini-service";
import { WeatherService } from "./weather-service";
import { ElevenLabsTtsService } from "./elevenlabs-tts-service";
import { removeBackground } from "./background-removal-service";

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
}): Promise<{
  inserted: boolean;
  copiedToClipboard: boolean;
  fallbackCopiedToClipboard: boolean;
}> {
  if (params.deliveryMode === "none") {
    return {
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  if (params.deliveryMode === "tts") {
    notify("Jarvis", "Reading response aloud...");
    const ttsResult = await ElevenLabsTtsService.readAloud({
      text: params.transformedText,
    });

    if (!ttsResult.success) {
      // Fallback to clipboard if TTS fails
      writeClipboardText(params.transformedText);
      notify(
        "Jarvis",
        `TTS failed: ${ttsResult.error}. Response copied to clipboard.`,
      );
      return {
        inserted: false,
        copiedToClipboard: true,
        fallbackCopiedToClipboard: true,
      };
    }

    return {
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  if (params.deliveryMode === "insert") {
    const inserted = await insertTextAtCursor(params.transformedText);
    if (!inserted) {
      writeClipboardText(params.transformedText);
      notify("Jarvis", "Insert failed. Response copied to clipboard.");
      return {
        inserted: false,
        copiedToClipboard: true,
        fallbackCopiedToClipboard: true,
      };
    }

    return {
      inserted: true,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
    };
  }

  writeClipboardText(params.transformedText);
  notify("Jarvis", "Response copied to clipboard.");
  return {
    inserted: false,
    copiedToClipboard: true,
    fallbackCopiedToClipboard: true,
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
    };
  }

  if (routerRoute === "tts_read_aloud") {
    const textToRead = context.clipboard.text?.text ?? "";
    if (!textToRead || textToRead.trim().length === 0) {
      const errorMsg =
        "No text found to read aloud. Please copy some text first.";
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

    notify("Jarvis", "Reading text aloud...");
    const ttsResult = await ElevenLabsTtsService.readAloud({
      text: textToRead,
    });

    const resultText = ttsResult.success
      ? `Successfully read ${textToRead.length} characters aloud.`
      : `Failed to read text aloud: ${ttsResult.error}`;

    return {
      context,
      sourceText: textToRead,
      transformedText: resultText,
      promptMode: "direct_query",
      deliveryMode: "none",
      inserted: false,
      copiedToClipboard: false,
      fallbackCopiedToClipboard: false,
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
