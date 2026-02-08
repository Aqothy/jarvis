import type { BoundedText, ClipboardKind } from "../types";

export function boundText(value: string): BoundedText {
  const totalChars = value.length;
  return {
    text: value,
    truncated: false,
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
