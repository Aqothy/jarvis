import { readFile } from "node:fs/promises";
import https from "node:https";

function getRemoveBgApiKey(): string {
  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    throw new Error(
      "REMOVEBG_API_KEY is not set. Get a free API key from https://www.remove.bg/api and add it to your .env file.",
    );
  }
  return apiKey;
}

export interface RemoveBackgroundResult {
  success: boolean;
  imageBuffer?: Buffer;
  error?: string;
  creditsCharged?: number;
}

/**
 * Removes the background from an image using the Remove.bg API.
 * Supports PNG, JPG/JPEG formats.
 */
export async function removeBackground(params: {
  imagePath: string;
}): Promise<RemoveBackgroundResult> {
  const apiKey = getRemoveBgApiKey();

  try {
    // Read the input image
    const imageBuffer = await readFile(params.imagePath);
    const base64Image = imageBuffer.toString("base64");

    // Determine the image format
    const imageFormat = params.imagePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";

    console.log(
      `[Background Removal] Processing image: ${params.imagePath} (${imageFormat})`,
    );

    // Call Remove.bg API
    const resultBuffer = await callRemoveBgApi({
      apiKey,
      imageBase64: base64Image,
      imageFormat,
    });

    console.log(
      `[Background Removal] Successfully removed background. Output size: ${resultBuffer.length} bytes`,
    );

    return {
      success: true,
      imageBuffer: resultBuffer,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[Background Removal] Error: ${errorMessage}`);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

interface RemoveBgApiParams {
  apiKey: string;
  imageBase64: string;
  imageFormat: string;
}

function callRemoveBgApi(params: RemoveBgApiParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      image_file_b64: params.imageBase64,
      size: "auto", // "auto" = highest available resolution
      format: "png", // Output format (PNG with transparency)
    });

    const options = {
      hostname: "api.remove.bg",
      port: 443,
      path: "/v1.0/removebg",
      method: "POST",
      headers: {
        "X-Api-Key": params.apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        const responseBuffer = Buffer.concat(chunks);

        if (res.statusCode === 200) {
          const creditsCharged = res.headers["x-credits-charged"];
          console.log(
            `[Remove.bg API] Success. Credits charged: ${creditsCharged || "unknown"}`,
          );
          resolve(responseBuffer);
        } else {
          // Try to parse error message from response
          let errorMessage = `Remove.bg API error (${res.statusCode})`;
          try {
            const errorResponse = JSON.parse(responseBuffer.toString());
            if (errorResponse.errors && Array.isArray(errorResponse.errors)) {
              errorMessage += `: ${errorResponse.errors.map((e: { title?: string }) => e.title || "Unknown error").join(", ")}`;
            }
          } catch {
            errorMessage += `: ${responseBuffer.toString().substring(0, 200)}`;
          }
          reject(new Error(errorMessage));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Remove.bg API request failed: ${error.message}`));
    });

    req.write(postData);
    req.end();
  });
}
