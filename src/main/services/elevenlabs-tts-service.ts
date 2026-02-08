import log from "electron-log/main.js";
import { execFile, type ExecException } from "node:child_process";
import { unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app, globalShortcut } from "electron";
import { randomUUID } from "node:crypto";

interface TextToSpeechParams {
  text: string;
  voiceName?: string;
  autoPlay?: boolean;
}

interface TextToSpeechResult {
  success: boolean;
  audioFilePath?: string;
  error?: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

/**
 * ElevenLabs Text-to-Speech Service
 * Handles converting text to speech and playing audio.
 */
export class ElevenLabsTtsService {
  private static defaultVoice = "Adam";
  private static lastAudioPath: string | null = null;
  private static activePlayback: ReturnType<typeof execFile> | null = null;
  private static stopShortcuts = new Set<string>();

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static registerStopShortcut(accelerator: string): void {
    if (this.stopShortcuts.has(accelerator)) {
      return;
    }
    if (!app.isReady()) {
      return;
    }

    const registered = globalShortcut.register(accelerator, () => {
      void this.stopActivePlayback();
    });
    if (registered) {
      this.stopShortcuts.add(accelerator);
    }
  }

  private static registerStopShortcuts(): void {
    this.registerStopShortcut("Ctrl+C");
  }

  private static unregisterStopShortcuts(): void {
    for (const accelerator of this.stopShortcuts) {
      globalShortcut.unregister(accelerator);
    }
    this.stopShortcuts.clear();
  }

  private static async cleanupAudioFile(path: string): Promise<void> {
    await unlink(path).catch(() => undefined);
  }

  static async stopActivePlayback(): Promise<void> {
    const playback = this.activePlayback;
    this.activePlayback = null;

    if (playback && playback.exitCode === null) {
      playback.kill("SIGTERM");
      await this.delay(300);
    }

    this.unregisterStopShortcuts();

    const audioPath = this.lastAudioPath;
    this.lastAudioPath = null;
    if (audioPath) {
      await this.cleanupAudioFile(audioPath);
    }
  }

  /**
   * Convert text to speech using ElevenLabs and optionally play it.
   */
  static async textToSpeech(
    params: TextToSpeechParams,
  ): Promise<TextToSpeechResult> {
    try {
      const voiceName = params.voiceName || this.defaultVoice;

      if (this.lastAudioPath) {
        try {
          await this.cleanupAudioFile(this.lastAudioPath);
          this.lastAudioPath = null;
        } catch (err) {
          log.debug("Failed to clean up previous audio file:", err);
        }
      }

      log.info(
        `[ElevenLabs TTS] Converting text to speech (${params.text.length} chars)`,
      );

      const result = await this.callElevenLabsApi(params.text, voiceName);
      if (!result.success || !result.audioFilePath) {
        throw new Error(result.error || "Failed to generate speech");
      }

      this.lastAudioPath = result.audioFilePath;

      if (params.autoPlay) {
        try {
          await this.playAudio(result.audioFilePath);
        } finally {
          await this.cleanupAudioFile(result.audioFilePath);
          if (this.lastAudioPath === result.audioFilePath) {
            this.lastAudioPath = null;
          }
        }
      }

      return {
        success: true,
        audioFilePath: result.audioFilePath,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown TTS error";
      log.error("[ElevenLabs TTS] Error:", message);
      return {
        success: false,
        error: message,
      };
    }
  }

  static async playAudio(audioFilePath: string): Promise<void> {
    try {
      log.info(`[ElevenLabs TTS] Playing audio: ${audioFilePath}`);

      const platform = process.platform;
      if (platform === "darwin") {
        await new Promise<void>((resolve, reject) => {
          this.registerStopShortcuts();

          const playback = execFile("afplay", [audioFilePath], (error) => {
            if (this.activePlayback === playback) {
              this.activePlayback = null;
            }
            this.unregisterStopShortcuts();

            if (error) {
              const execError = error as ExecException;
              if (execError.signal === "SIGTERM") {
                resolve();
                return;
              }
              reject(
                new Error(
                  execError.message || "afplay process failed unexpectedly.",
                ),
              );
              return;
            }

            resolve();
          });

          this.activePlayback = playback;
        });

        log.info("[ElevenLabs TTS] Audio playback completed");
        return;
      }

      if (platform === "linux" || platform === "win32") {
        throw new Error(
          "Playback cancellation support is currently implemented for macOS only.",
        );
      }

      throw new Error(`Unsupported platform: ${platform}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown playback error";
      log.error("[ElevenLabs TTS] Playback error:", message);
      throw new Error(`Failed to play audio: ${message}`);
    }
  }

  private static getApiKey(): string {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Add it to your .env file.",
      );
    }
    return apiKey;
  }

  private static getTtsModel(): string {
    const model =
      process.env.ELEVENLABS_TTS_MODEL ||
      process.env.ELEVENLABS_MODEL_ID ||
      process.env.ELEVENLABS_MODEL;
    if (!model || model.trim().length === 0) {
      return "eleven_flash_v2_5";
    }
    return model.trim();
  }

  private static getVoiceIdOverride(): string | null {
    const voiceId = process.env.ELEVENLABS_TTS_VOICE_ID;
    if (!voiceId || voiceId.trim().length === 0) {
      return null;
    }
    return voiceId.trim();
  }

  private static async getVoiceId(voiceName: string): Promise<string> {
    const voiceIdOverride = this.getVoiceIdOverride();
    if (voiceIdOverride) {
      return voiceIdOverride;
    }

    const apiKey = this.getApiKey();

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: {
          "xi-api-key": apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch voices: ${response.statusText}`);
      }

      const data = (await response.json()) as ElevenLabsVoicesResponse;
      const voice = data.voices?.find(
        (candidate: ElevenLabsVoice) =>
          candidate.name.toLowerCase() === voiceName.toLowerCase(),
      );

      if (!voice) {
        log.warn(`Voice "${voiceName}" not found, using first available voice`);
        return data.voices?.[0]?.voice_id || "21m00Tcm4TlvDq8ikWAM";
      }

      return voice.voice_id;
    } catch (error) {
      log.error("[ElevenLabs TTS] Failed to get voice ID:", error);
      return "21m00Tcm4TlvDq8ikWAM";
    }
  }

  private static async callElevenLabsApi(
    text: string,
    voiceName: string,
  ): Promise<TextToSpeechResult> {
    try {
      const apiKey = this.getApiKey();
      const voiceId = await this.getVoiceId(voiceName);
      const modelId = this.getTtsModel();

      log.info(
        `[ElevenLabs TTS] Generating speech with voice: ${voiceName}, model: ${modelId}`,
      );

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            Accept: "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `ElevenLabs API error: ${response.status} ${errorText}`,
        );
      }

      const audioBuffer = await response.arrayBuffer();
      const outputDir = join(app.getPath("userData"), "tts");
      await mkdir(outputDir, { recursive: true });

      const audioFilePath = join(outputDir, `speech-${randomUUID()}.mp3`);
      await writeFile(audioFilePath, Buffer.from(audioBuffer));

      log.info(`[ElevenLabs TTS] Audio saved to: ${audioFilePath}`);
      return {
        success: true,
        audioFilePath,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown API error";
      log.error("[ElevenLabs TTS] API call failed:", message);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Extract text content for reading aloud.
   */
  static extractReadableText(content: string): string {
    let text = content;

    text = text.replace(/```[\s\S]*?```/g, "");
    text = text.replace(/`[^`]+`/g, "");
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/^#{1,6}\s+/gm, "");
    text = text.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");
    text = text.replace(/https?:\/\/[^\s]+/g, "");
    text = text.replace(/\s+/g, " ").trim();

    return text;
  }

  static async readAloud(params: {
    text: string;
    voiceName?: string;
  }): Promise<TextToSpeechResult> {
    const cleanText = this.extractReadableText(params.text);

    if (!cleanText || cleanText.length === 0) {
      return {
        success: false,
        error: "No readable text found",
      };
    }

    const maxLength = 5000;
    const truncatedText =
      cleanText.length > maxLength
        ? `${cleanText.substring(0, maxLength)}...`
        : cleanText;

    return this.textToSpeech({
      text: truncatedText,
      voiceName: params.voiceName,
      autoPlay: true,
    });
  }
}
