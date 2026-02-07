import type { AppBridge } from "../../main/types";

declare global {
  interface Window {
    jarvis: AppBridge;
  }
}

export {};

