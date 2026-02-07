import type { AppBridge } from "../../main/types";

// expose the AppBridge API to the Renderer process via the global 'window' object
declare global {
  interface Window {
    jarvis: AppBridge;
  }
}

export {};
