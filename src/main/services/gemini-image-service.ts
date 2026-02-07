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
  imagePath: string;
  instruction: string;
}): Promise<Buffer> {
  const client = getGeminiClient();
  const model = getGeminiImageModel();

  // Read the input image and convert to base64
  const inputImage = await readFile(params.imagePath);
  const base64Image = inputImage.toString("base64");

  // Prepare the request with both the instruction and the image
  // This enables image editing mode where Gemini modifies the existing image
  const response = await client.models.generateContent({
    model,
    contents: [
      {
        parts: [
          {
            text: params.instruction
          },
          {
            inline_data: {
              mime_type: "image/png",
              data: base64Image
            }
          }
        ]
      }
    ]
  });

  // Extract the generated image from the response
  // Gemini returns images as base64 in inline_data parts
  if (!response.candidates?.[0]?.content?.parts) {
    throw new Error("Gemini image generation returned no content parts.");
  }

  const parts = response.candidates[0].content.parts;
  const imagePart = parts.find((part) => part.inline_data?.data);

  if (!imagePart?.inline_data?.data) {
    throw new Error("Gemini image generation did not return image data.");
  }

  const base64Output = imagePart.inline_data.data;
  return Buffer.from(base64Output, "base64");
}
