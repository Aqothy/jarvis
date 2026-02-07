import { readFile } from "node:fs/promises";

const OPENAI_API_URL = "https://api.openai.com/v1";

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to your environment before running tasks.");
  }
  return apiKey;
}

async function parseJsonOrThrow(response: Response): Promise<any> {
  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed";
    throw new Error(message);
  }
  return data;
}

export async function transformClipboardImage(params: {
  imagePath: string;
  instruction: string;
}): Promise<Buffer> {
  const apiKey = getApiKey();
  const inputImage = await readFile(params.imagePath);

  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("prompt", params.instruction);
  form.append("size", "1024x1024");
  form.append("response_format", "b64_json");
  form.append("image", new Blob([inputImage], { type: "image/png" }), "clipboard.png");

  const response = await fetch(`${OPENAI_API_URL}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const data = await parseJsonOrThrow(response);
  const b64 = data?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("Image transform did not return image data.");
  }

  return Buffer.from(b64, "base64");
}
