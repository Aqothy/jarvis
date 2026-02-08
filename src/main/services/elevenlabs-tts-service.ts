import log from "electron-log/main.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

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

/**
 * ElevenLabs Text-to-Speech Service
 * Handles converting text to speech and playing audio
 */
export class ElevenLabsTtsService {
  private static defaultVoice = "Adam"; // Default ElevenLabs voice
  private static lastAudioPath: string | null = null;

  /**
   * Convert text to speech using ElevenLabs and optionally play it
   */
  static async textToSpeech(
    params: TextToSpeechParams,
  ): Promise<TextToSpeechResult> {
    try {
      const voiceName = params.voiceName || this.defaultVoice;

      // Clean up previous audio file if exists
      if (this.lastAudioPath) {
        try {
          await unlink(this.lastAudioPath);
        } catch (err) {
          log.debug("Failed to clean up previous audio file:", err);
        }
      }

      log.info(
        `[ElevenLabs TTS] Converting text to speech (${params.text.length} chars)`,
      );

      // Call ElevenLabs MCP text_to_speech tool
      // Note: This assumes the MCP tool is available via claude-code
      // In production, you'd need to integrate with the MCP server directly
      const result = await this.callElevenLabsMcp(params.text, voiceName);

      if (!result.success || !result.audioFilePath) {
        throw new Error(result.error || "Failed to generate speech");
      }

      this.lastAudioPath = result.audioFilePath;

      // Auto-play if requested
      if (params.autoPlay) {
        await this.playAudio(result.audioFilePath);
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

  /**
   * Play an audio file
   */
  static async playAudio(audioFilePath: string): Promise<void> {
    try {
      log.info(`[ElevenLabs TTS] Playing audio: ${audioFilePath}`);

      // Use platform-specific audio player
      const platform = process.platform;
      let command: string;

      if (platform === "darwin") {
        // macOS
        command = `afplay "${audioFilePath}"`;
      } else if (platform === "linux") {
        // Linux - try multiple players
        command = `(paplay "${audioFilePath}" || aplay "${audioFilePath}" || ffplay -nodisp -autoexit "${audioFilePath}")`;
      } else if (platform === "win32") {
        // Windows
        command = `powershell -c (New-Object Media.SoundPlayer "${audioFilePath}").PlaySync()`;
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }

      await execAsync(command);
      log.info("[ElevenLabs TTS] Audio playback completed");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown playback error";
      log.error("[ElevenLabs TTS] Playback error:", message);
      throw new Error(`Failed to play audio: ${message}`);
    }
  }

  /**
   * Get ElevenLabs API key from environment
   */
  private static getApiKey(): string {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ELEVENLABS_API_KEY is not set. Add it to your .env file.",
      );
    }
    return apiKey;
  }

  /**
   * Get voice ID for a given voice name
   */
  private static async getVoiceId(voiceName: string): Promise<string> {
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

      const data = await response.json();
      const voice = data.voices?.find(
        (v: { name: string }) =>
          v.name.toLowerCase() === voiceName.toLowerCase(),
      );

      if (!voice) {
        log.warn(
          `Voice "${voiceName}" not found, using first available voice`,
        );
        return data.voices?.[0]?.voice_id || "21m00Tcm4TlvDq8ikWAM"; // Fallback to Rachel
      }

      return voice.voice_id;
    } catch (error) {
      log.error("[ElevenLabs TTS] Failed to get voice ID:", error);
      // Fallback to a known voice ID (Rachel)
      return "21m00Tcm4TlvDq8ikWAM";
    }
  }

  /**
   * Call ElevenLabs API to generate speech
   */
  private static async callElevenLabsMcp(
    text: string,
    voiceName: string,
  ): Promise<TextToSpeechResult> {
    try {
      const apiKey = this.getApiKey();
      const voiceId = await this.getVoiceId(voiceName);

      log.info(`[ElevenLabs TTS] Generating speech with voice: ${voiceName}`);

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
            model_id: "eleven_monolingual_v1",
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

      // Save audio to file
      const audioBuffer = await response.arrayBuffer();
      const outputDir = join(app.getPath("userData"), "tts");
      await mkdir(outputDir, { recursive: true }); // Ensure directory exists

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
   * Extract text content for reading aloud
   * Cleans up markdown, HTML, and other formatting
   */
  static extractReadableText(content: string): string {
    let text = content;

    // Remove markdown code blocks
    text = text.replace(/```[\s\S]*?```/g, "");

    // Remove inline code
    text = text.replace(/`[^`]+`/g, "");

    // Remove markdown links but keep text
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Remove markdown images
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

    // Remove HTML tags
    text = text.replace(/<[^>]+>/g, "");

    // Remove markdown headers
    text = text.replace(/^#{1,6}\s+/gm, "");

    // Remove markdown bold/italic
    text = text.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");

    // Remove URLs
    text = text.replace(/https?:\/\/[^\s]+/g, "");

    // Clean up multiple spaces and newlines
    text = text.replace(/\s+/g, " ").trim();

    return text;
  }

  /**
   * Read text aloud from clipboard or provided text
   */
  static async readAloud(params: {
    text: string;
    voiceName?: string;
  }): Promise<TextToSpeechResult> {
    // Extract clean text for reading
    const cleanText = this.extractReadableText(params.text);

    if (!cleanText || cleanText.length === 0) {
      return {
        success: false,
        error: "No readable text found",
      };
    }

    // Limit text length for reasonable speech duration
    const maxLength = 5000; // ~5 minutes of speech
    const truncatedText =
      cleanText.length > maxLength
        ? cleanText.substring(0, maxLength) + "..."
        : cleanText;

    return this.textToSpeech({
      text: truncatedText,
      voiceName: params.voiceName,
      autoPlay: true,
    });
  }
}
