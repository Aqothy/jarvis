import type { BoundedText, ClipboardKind } from "../types";

export const MAX_CONTEXT_TEXT_CHARS = 4000;

export function boundText(
  value: string,
  limit = MAX_CONTEXT_TEXT_CHARS,
): BoundedText {
  const totalChars = value.length;
  if (value.length <= limit) {
    return { text: value, truncated: false, totalChars };
  }
  return {
    text: value.slice(0, limit),
    truncated: true,
    totalChars,
  };
}

export function pickSourceUsed(input: {
  clipboardKind: ClipboardKind;
  clipboardText?: string;
}): "clipboard_text" | "clipboard_image" | "none" {
  if (
    input.clipboardKind === "text" &&
    input.clipboardText &&
    input.clipboardText.trim().length > 0
  ) {
    return "clipboard_text";
  }

  if (input.clipboardKind === "image") {
    return "clipboard_image";
  }

  return "none";
}
