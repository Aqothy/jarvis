import type { SpeechPreferences, SpeechProvider } from "../types";

const speechPreferences: SpeechPreferences = {
  ttsProvider: "gradium",
  ttsEnabled: false,
};

export function getSpeechPreferences(): SpeechPreferences {
  return {
    ttsProvider: speechPreferences.ttsProvider,
    ttsEnabled: speechPreferences.ttsEnabled,
  };
}

export function getTtsProvider(): SpeechProvider {
  return speechPreferences.ttsProvider;
}

export function setTtsProvider(provider: SpeechProvider): void {
  speechPreferences.ttsProvider = provider;
}

export function getTtsEnabled(): boolean {
  return speechPreferences.ttsEnabled;
}

export function setTtsEnabled(enabled: boolean): void {
  speechPreferences.ttsEnabled = enabled;
}
