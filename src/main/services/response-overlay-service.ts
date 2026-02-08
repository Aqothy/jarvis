import type { OverlayPayload } from "../types";

interface ResponseOverlayHandlers {
  onShow: (payload: OverlayPayload) => void;
  onDismiss: () => void;
}

let handlers: ResponseOverlayHandlers | null = null;

export function setResponseOverlayHandlers(
  nextHandlers: ResponseOverlayHandlers,
): void {
  handlers = nextHandlers;
}

export function showResponseOverlay(payload: OverlayPayload): void {
  handlers?.onShow(payload);
}

export function dismissResponseOverlay(): void {
  handlers?.onDismiss();
}
