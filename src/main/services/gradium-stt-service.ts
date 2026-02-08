import { app, globalShortcut } from "electron";
import { execFile, type ExecException } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket, { RawData } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GradiumServerMessage {
  type?: string;
  text?: string;
  message?: string;
  code?: number;
}

interface SttStream {
  stopRequested: boolean;
  transcriptSegments: string[];
  pendingAudioChunks: string[];
  error: Error | null;
  completionPromise: Promise<string>;
  resolveCompletion: (transcript: string) => void;
  rejectCompletion: (reason: Error) => void;
  completionSettled: boolean;
}

interface ConnectionState {
  socket: WebSocket | null;
  ready: boolean;
  connectingPromise: Promise<void> | null;
  resolveReady: (() => void) | null;
  rejectReady: ((reason: Error) => void) | null;
  readySettled: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  shutdownRequested: boolean;
  activeStream: SttStream | null;
  preStreamAudioChunks: string[];
  startingStreamPromise: Promise<void> | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 1000;
const MAX_PRE_STREAM_AUDIO_CHUNKS = 64;

const connectionState: ConnectionState = {
  socket: null,
  ready: false,
  connectingPromise: null,
  resolveReady: null,
  rejectReady: null,
  readySettled: false,
  reconnectTimer: null,
  shutdownRequested: false,
  activeStream: null,
  preStreamAudioChunks: [],
  startingStreamPromise: null,
};

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getGradiumApiKey(): string {
  const key = process.env.GRADIUM_API_KEY;
  if (!key) {
    throw new Error(
      "GRADIUM_API_KEY is not set. Add it to your environment before using STT.",
    );
  }
  return key;
}

function getGradiumEndpoint(): string {
  const region = (process.env.GRADIUM_STT_REGION || "us").toLowerCase();
  return region === "eu"
    ? "wss://eu.api.gradium.ai/api/speech/asr"
    : "wss://us.api.gradium.ai/api/speech/asr";
}

function getGradiumModelName(): string {
  return process.env.GRADIUM_STT_MODEL || "default";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function settleStreamOnce<T>(
  stream: SttStream,
  action: "resolve" | "reject",
  value: T,
): void {
  if (stream.completionSettled) return;
  stream.completionSettled = true;

  if (action === "resolve") {
    stream.resolveCompletion(value as string);
  } else {
    stream.rejectCompletion(value as Error);
  }
}

function settleConnectionReady(
  action: "resolve" | "reject",
  error?: Error,
): void {
  if (connectionState.readySettled) {
    return;
  }
  connectionState.readySettled = true;

  const resolveReady = connectionState.resolveReady;
  const rejectReady = connectionState.rejectReady;

  connectionState.connectingPromise = null;
  connectionState.resolveReady = null;
  connectionState.rejectReady = null;

  if (action === "resolve") {
    resolveReady?.();
  } else {
    rejectReady?.(
      error ?? new Error("Gradium STT connection failed to become ready."),
    );
  }
}

function clearReconnectTimer(): void {
  if (connectionState.reconnectTimer) {
    clearTimeout(connectionState.reconnectTimer);
    connectionState.reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (connectionState.shutdownRequested || connectionState.reconnectTimer) {
    return;
  }

  connectionState.reconnectTimer = setTimeout(() => {
    connectionState.reconnectTimer = null;
    ensureConnectionReady().catch(() => {
      scheduleReconnect();
    });
  }, RECONNECT_DELAY_MS);
}

function buildTranscript(stream: SttStream): string {
  return stream.transcriptSegments.join(" ").trim();
}

function createStream(): SttStream {
  let resolveCompletion!: (transcript: string) => void;
  let rejectCompletion!: (reason: Error) => void;

  const completionPromise = new Promise<string>((res, rej) => {
    resolveCompletion = res;
    rejectCompletion = rej;
  });

  completionPromise.catch(() => undefined);

  return {
    stopRequested: false,
    transcriptSegments: [],
    pendingAudioChunks: [],
    error: null,
    completionPromise,
    resolveCompletion,
    rejectCompletion,
    completionSettled: false,
  };
}

function enqueuePreStreamAudioChunk(base64Audio: string): void {
  connectionState.preStreamAudioChunks.push(base64Audio);
  if (
    connectionState.preStreamAudioChunks.length > MAX_PRE_STREAM_AUDIO_CHUNKS
  ) {
    connectionState.preStreamAudioChunks.shift();
  }
}

function failStream(stream: SttStream, error: Error): void {
  if (!stream.error) {
    stream.error = error;
  }
  settleStreamOnce(stream, "reject", error);

  if (connectionState.activeStream === stream) {
    connectionState.activeStream = null;
  }
}

function flushPendingAudio(): void {
  const stream = connectionState.activeStream;
  const socket = connectionState.socket;
  if (!stream || !socket || !connectionState.ready) return;
  if (socket.readyState !== WebSocket.OPEN) return;

  while (stream.pendingAudioChunks.length > 0) {
    const chunk = stream.pendingAudioChunks.shift();
    if (!chunk) {
      break;
    }
    socket.send(JSON.stringify({ type: "audio", audio: chunk }));
  }
}

function maybeSendEndOfStream(): void {
  const stream = connectionState.activeStream;
  const socket = connectionState.socket;
  if (!stream || !socket || !connectionState.ready) return;
  if (!stream.stopRequested || socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({ type: "end_of_stream" }));
}

function closeSocketIfOpen(): void {
  const socket = connectionState.socket;
  if (!socket) {
    return;
  }

  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close();
  }
}

function handleSocketFailure(error: Error): void {
  settleConnectionReady("reject", error);

  const activeStream = connectionState.activeStream;
  if (activeStream) {
    failStream(activeStream, error);
  }

  closeSocketIfOpen();
}

function resetConnectionForClose(closedSocket: WebSocket): void {
  if (connectionState.socket !== closedSocket) {
    return;
  }

  connectionState.socket = null;
  connectionState.ready = false;
  connectionState.connectingPromise = null;
  connectionState.resolveReady = null;
  connectionState.rejectReady = null;
  connectionState.readySettled = false;
}

function createConnectionPromise(): Promise<void> {
  const readyPromise = new Promise<void>((resolve, reject) => {
    connectionState.resolveReady = resolve;
    connectionState.rejectReady = reject;
  });

  readyPromise.catch(() => undefined);
  connectionState.connectingPromise = readyPromise;
  connectionState.readySettled = false;
  return readyPromise;
}

function connectSocket(): Promise<void> {
  if (connectionState.shutdownRequested) {
    connectionState.shutdownRequested = false;
  }

  const apiKey = getGradiumApiKey();
  const endpoint = getGradiumEndpoint();
  const socket = new WebSocket(endpoint, {
    headers: { "x-api-key": apiKey },
  });

  clearReconnectTimer();

  connectionState.socket = socket;
  connectionState.ready = false;

  const readyPromise = createConnectionPromise();

  socket.on("open", () => {
    if (connectionState.socket !== socket) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "setup",
        model_name: getGradiumModelName(),
        input_format: "pcm",
      }),
    );
  });

  socket.on("message", (raw: RawData) => {
    if (connectionState.socket !== socket) {
      return;
    }
    handleMessage(raw);
  });

  socket.on("error", (error: Error) => {
    if (connectionState.socket !== socket) {
      return;
    }
    handleSocketFailure(error);
  });

  socket.on("close", () => {
    if (connectionState.socket !== socket) {
      return;
    }

    const stream = connectionState.activeStream;
    if (stream) {
      if (stream.stopRequested) {
        settleStreamOnce(stream, "resolve", buildTranscript(stream));
      } else {
        failStream(
          stream,
          new Error("Gradium STT connection closed unexpectedly."),
        );
      }
      connectionState.activeStream = null;
    }

    if (!connectionState.ready) {
      settleConnectionReady(
        "reject",
        new Error("Gradium STT connection closed before becoming ready."),
      );
    }

    resetConnectionForClose(socket);

    if (!connectionState.shutdownRequested) {
      scheduleReconnect();
    }
  });

  return readyPromise;
}

async function ensureConnectionReady(): Promise<void> {
  if (connectionState.shutdownRequested) {
    connectionState.shutdownRequested = false;
  }

  const socket = connectionState.socket;

  if (socket && connectionState.ready && socket.readyState === WebSocket.OPEN) {
    return;
  }

  if (connectionState.connectingPromise) {
    await connectionState.connectingPromise;
    return;
  }

  await connectSocket();
}

// ---------------------------------------------------------------------------
// WebSocket message handler
// ---------------------------------------------------------------------------

function handleMessage(raw: RawData): void {
  let parsed: GradiumServerMessage;
  try {
    parsed = JSON.parse(String(raw)) as GradiumServerMessage;
  } catch {
    return; // Ignore unparseable frames.
  }

  switch (parsed.type) {
    case "ready":
      connectionState.ready = true;
      settleConnectionReady("resolve");
      flushPendingAudio();
      maybeSendEndOfStream();
      break;

    case "text": {
      const stream = connectionState.activeStream;
      if (!stream) {
        break;
      }

      const segment = typeof parsed.text === "string" ? parsed.text.trim() : "";
      if (segment.length > 0) {
        const last =
          stream.transcriptSegments[stream.transcriptSegments.length - 1];
        if (last !== segment) {
          stream.transcriptSegments.push(segment);
        }
      }
      break;
    }

    case "error": {
      const msg =
        typeof parsed.message === "string"
          ? parsed.message
          : "Unknown Gradium STT error";
      const suffix =
        typeof parsed.code === "number" ? ` (code ${parsed.code})` : "";
      handleSocketFailure(new Error(`Gradium STT failed${suffix}: ${msg}`));
      break;
    }

    case "end_of_stream": {
      const stream = connectionState.activeStream;
      if (stream) {
        settleStreamOnce(stream, "resolve", buildTranscript(stream));
        connectionState.activeStream = null;
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initializeGradiumSttConnection(): Promise<void> {
  if (connectionState.shutdownRequested) {
    connectionState.shutdownRequested = false;
  }
  await ensureConnectionReady();
}

export async function startGradiumSttSession(): Promise<void> {
  if (connectionState.shutdownRequested) {
    connectionState.shutdownRequested = false;
  }

  if (connectionState.activeStream) {
    throw new Error("A Gradium STT stream is already active.");
  }

  if (connectionState.startingStreamPromise) {
    throw new Error("A Gradium STT stream is already starting.");
  }

  const startPromise = (async (): Promise<void> => {
    // Reset any stale pre-session audio before beginning a new capture session.
    connectionState.preStreamAudioChunks = [];

    await ensureConnectionReady();

    const socket = connectionState.socket;
    if (
      !socket ||
      !connectionState.ready ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new Error(
        "Gradium STT connection is not ready yet. Try again in a moment.",
      );
    }

    const stream = createStream();
    if (connectionState.preStreamAudioChunks.length > 0) {
      stream.pendingAudioChunks.push(...connectionState.preStreamAudioChunks);
      connectionState.preStreamAudioChunks = [];
    }
    connectionState.activeStream = stream;
    flushPendingAudio();
  })();

  connectionState.startingStreamPromise = startPromise;
  try {
    await startPromise;
  } finally {
    if (connectionState.startingStreamPromise === startPromise) {
      connectionState.startingStreamPromise = null;
    }
  }
}

export function pushGradiumSttAudioChunk(audioBuffer: ArrayBuffer): void {
  const base64 = Buffer.from(audioBuffer).toString("base64");
  const stream = connectionState.activeStream;

  // Audio can arrive slightly before session creation due to IPC/worklet timing.
  // Buffer a bounded amount so startup races don't drop initial speech.
  if (!stream) {
    enqueuePreStreamAudioChunk(base64);
    return;
  }

  if (stream.error) {
    throw stream.error;
  }

  const socket = connectionState.socket;
  if (
    !socket ||
    !connectionState.ready ||
    socket.readyState !== WebSocket.OPEN
  ) {
    stream.pendingAudioChunks.push(base64);
    return;
  }

  socket.send(JSON.stringify({ type: "audio", audio: base64 }));
}

export async function stopGradiumSttSession(): Promise<string> {
  let stream = connectionState.activeStream;
  if (!stream && connectionState.startingStreamPromise) {
    await connectionState.startingStreamPromise;
    stream = connectionState.activeStream;
  }

  if (!stream) {
    throw new Error("No active Gradium STT stream.");
  }
  if (stream.error) {
    if (connectionState.activeStream === stream) {
      connectionState.activeStream = null;
    }
    throw stream.error;
  }

  stream.stopRequested = true;

  const socket = connectionState.socket;
  if (socket && connectionState.ready && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "end_of_stream" }));
  } else {
    const error = new Error(
      "Gradium STT connection is not ready. Unable to finalize transcription stream.",
    );
    failStream(stream, error);
    throw error;
  }

  const transcript = (await stream.completionPromise).trim();
  if (connectionState.activeStream === stream) {
    connectionState.activeStream = null;
  }
  return transcript;
}

export function shutdownGradiumSttConnection(): void {
  connectionState.shutdownRequested = true;
  clearReconnectTimer();
  connectionState.preStreamAudioChunks = [];
  connectionState.startingStreamPromise = null;

  const stream = connectionState.activeStream;
  if (stream) {
    failStream(
      stream,
      new Error("Gradium STT stream closed during app shutdown."),
    );
    connectionState.activeStream = null;
  }

  const socket = connectionState.socket;
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  ) {
    socket.close();
  }

  connectionState.socket = null;
  connectionState.ready = false;
  connectionState.connectingPromise = null;
  connectionState.resolveReady = null;
  connectionState.rejectReady = null;
  connectionState.readySettled = false;
}

// ---------------------------------------------------------------------------
// TTS API
// ---------------------------------------------------------------------------

interface GradiumTtsRequestBody {
  text: string;
  voice_id: string;
  output_format: "wav" | "pcm" | "opus";
  model_name: string;
  only_audio: boolean;
}

let activeTtsPlayback: ReturnType<typeof execFile> | null = null;
let activeTtsAudioPath: string | null = null;
const ttsStopShortcuts = new Set<string>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGradiumTtsRegion(): "us" | "eu" {
  const region = (process.env.GRADIUM_TTS_REGION || "us").toLowerCase();
  return region === "eu" ? "eu" : "us";
}

function getGradiumTtsEndpoint(): string {
  return getGradiumTtsRegion() === "eu"
    ? "https://eu.api.gradium.ai/api/post/speech/tts"
    : "https://us.api.gradium.ai/api/post/speech/tts";
}

function getGradiumTtsModel(): string {
  return process.env.GRADIUM_TTS_MODEL || "default";
}

function getGradiumTtsVoice(): string {
  const voice = process.env.GRADIUM_TTS_VOICE_ID;
  if (!voice || voice.trim().length === 0) {
    throw new Error(
      "GRADIUM_TTS_VOICE_ID is not set. Configure a Gradium voice before enabling TTS output.",
    );
  }
  return voice.trim();
}

function getGradiumTtsOutputFormat(): "wav" | "pcm" | "opus" {
  const format = (process.env.GRADIUM_TTS_OUTPUT_FORMAT || "wav").toLowerCase();
  if (format === "pcm" || format === "opus") {
    return format;
  }
  return "wav";
}

function getAudioFileExtension(format: "wav" | "pcm" | "opus"): string {
  if (format === "opus") {
    return "ogg";
  }
  if (format === "pcm") {
    return "pcm";
  }
  return "wav";
}

function extractAudioFromJsonPayload(payload: unknown): Buffer | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const obj = payload as Record<string, unknown>;
  const candidates = [obj.audio, obj.audio_base64, obj.base64_audio, obj.data];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      try {
        return Buffer.from(candidate, "base64");
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

function registerTtsStopShortcut(accelerator: string): void {
  if (ttsStopShortcuts.has(accelerator)) {
    return;
  }
  if (!app.isReady()) {
    return;
  }
  const registered = globalShortcut.register(accelerator, () => {
    void stopActiveTtsPlayback();
  });
  if (registered) {
    ttsStopShortcuts.add(accelerator);
  }
}

function registerTtsStopShortcuts(): void {
  registerTtsStopShortcut("Ctrl+C");
}

function unregisterTtsStopShortcuts(): void {
  for (const accelerator of ttsStopShortcuts) {
    globalShortcut.unregister(accelerator);
  }
  ttsStopShortcuts.clear();
}

async function requestGradiumTtsAudio(text: string): Promise<Buffer> {
  const outputFormat = getGradiumTtsOutputFormat();
  const body: GradiumTtsRequestBody = {
    text,
    voice_id: getGradiumTtsVoice(),
    output_format: outputFormat,
    model_name: getGradiumTtsModel(),
    only_audio: true,
  };
  const endpoint = getGradiumTtsEndpoint();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": getGradiumApiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const suffix = errorBody.trim().length > 0 ? ` - ${errorBody.trim()}` : "";
    throw new Error(
      `Gradium TTS request failed: ${response.status} ${response.statusText}${suffix}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.toLowerCase().includes("application/json")) {
    const payload = (await response.json()) as unknown;
    const audioFromJson = extractAudioFromJsonPayload(payload);
    if (!audioFromJson || audioFromJson.length === 0) {
      throw new Error("Gradium TTS returned JSON without audio payload.");
    }
    return audioFromJson;
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error("Gradium TTS returned an empty audio payload.");
  }
  return audioBuffer;
}

function playAudioFile(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    registerTtsStopShortcuts();
    const playback = execFile("afplay", [path], (error) => {
      if (activeTtsPlayback === playback) {
        activeTtsPlayback = null;
      }
      unregisterTtsStopShortcuts();

      if (error) {
        const execError = error as ExecException;
        if (execError.signal === "SIGTERM") {
          resolve();
          return;
        }
        reject(
          new Error(
            error instanceof Error ? error.message : "afplay process failed.",
          ),
        );
        return;
      }
      resolve();
    });
    activeTtsPlayback = playback;
  });
}

async function cleanupTtsFile(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
  if (activeTtsAudioPath === path) {
    activeTtsAudioPath = null;
  }
}

async function stopActiveTtsPlayback(): Promise<void> {
  const currentPlayback = activeTtsPlayback;
  activeTtsPlayback = null;

  if (currentPlayback && currentPlayback.exitCode === null) {
    currentPlayback.kill("SIGTERM");
    await delay(500);
  }
  unregisterTtsStopShortcuts();

  const currentPath = activeTtsAudioPath;
  activeTtsAudioPath = null;
  if (currentPath) {
    await unlink(currentPath).catch(() => undefined);
  }
}

export async function synthesizeAndPlay(text: string): Promise<void> {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return;
  }

  await stopActiveTtsPlayback();
  const audioBuffer = await requestGradiumTtsAudio(normalized);
  const outputFormat = getGradiumTtsOutputFormat();
  const extension = getAudioFileExtension(outputFormat);
  const tempPath = join(
    app.getPath("temp"),
    `jarvis-tts-${Date.now()}-${randomUUID()}.${extension}`,
  );
  activeTtsAudioPath = tempPath;
  await writeFile(tempPath, audioBuffer);

  try {
    await playAudioFile(tempPath);
  } finally {
    await cleanupTtsFile(tempPath);
  }
}
