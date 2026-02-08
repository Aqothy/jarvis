import { GoogleGenAI } from "@google/genai";
import { readFile } from "node:fs/promises";

function getGeminiApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your environment before running image tasks."
    );
  }
  return apiKey;
}

function getGeminiImageModel(): string {
  return process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
}

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return cachedClient;
}

/**
 * Transforms an image using Gemini's image generation/editing capabilities.
 * Supports both image editing (when an image is provided) and text-to-image generation.
 */
export async function transformClipboardImage(params: {
  instruction: string;
  imagePath?: string;
}): Promise<Buffer> {
  const client = getGeminiClient();
  const model = getGeminiImageModel();
  const mode = typeof params.imagePath === "string" ? "edit" : "generate";
  console.log(`[Image Task] model="${model}" mode="${mode}"`);

  const imageTaskInstruction =
    mode === "edit"
      ? `Edit the provided image according to this request and return image output only.\n${params.instruction}`
      : `Generate a new image according to this request and return image output only.\n${params.instruction}`;

  const contents: Array<
    | { text: string }
    | {
        inlineData: {
          mimeType: string;
          data: string;
        };
      }
  > = [
    {
      text: imageTaskInstruction,
    },
  ];

  // If an input image is provided, run in image-edit mode.
  // Without an image, run text-to-image generation.
  if (typeof params.imagePath === "string") {
    const inputImage = await readFile(params.imagePath);
    const base64Image = inputImage.toString("base64");
    contents.push({
      inlineData: {
        mimeType: "image/png",
        data: base64Image,
      },
    });
  }

  const response = await client.models.generateContent({
    model,
    contents,
    config: {
      responseModalities: ["IMAGE"],
    },
  });

  // Extract image bytes from any candidate/part that includes inlineData.
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      const data = part.inlineData?.data;
      if (typeof data === "string" && data.length > 0) {
        return Buffer.from(data, "base64");
      }
    }
  }

  const finishReason =
    candidates.length > 0 ? String(candidates[0].finishReason ?? "unknown") : "none";
  const responseText = typeof response.text === "string" ? response.text.trim() : "";
  const responseTextSuffix =
    responseText.length > 0 ? ` model_text="${responseText}"` : "";
  throw new Error(
    `Gemini image generation returned no image data. model="${model}" mode="${mode}" candidates=${candidates.length} finishReason="${finishReason}"${responseTextSuffix}`,
  );
}
