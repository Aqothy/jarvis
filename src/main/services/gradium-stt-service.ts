import WebSocket, { RawData } from "ws";

interface GradiumServerMessage {
  type?: string;
  text?: string;
  message?: string;
  code?: number;
}

interface SttSession {
  socket: WebSocket;
  ready: boolean;
  readySettled: boolean;
  completionSettled: boolean;
  stopRequested: boolean;
  transcriptSegments: string[];
  pendingAudioChunks: string[];
  error: Error | null;
  readyPromise: Promise<void>;
  completionPromise: Promise<string>;
  resolveReady: () => void;
  rejectReady: (reason: Error) => void;
  resolveCompletion: (transcript: string) => void;
  rejectCompletion: (reason: Error) => void;
}

let activeSession: SttSession | null = null;

function getGradiumApiKey(): string {
  const key = process.env.GRADIUM_API_KEY;
  if (!key) {
    throw new Error("GRADIUM_API_KEY is not set. Add it to your environment before using STT.");
  }
  return key;
}

function getGradiumEndpoint(): string {
  const region = (process.env.GRADIUM_STT_REGION || "us").toLowerCase();
  return region === "eu" ? "wss://eu.api.gradium.ai/api/speech/asr" : "wss://us.api.gradium.ai/api/speech/asr";
}

function getGradiumModelName(): string {
  return process.env.GRADIUM_STT_MODEL || "default";
}

function settleReady(session: SttSession): void {
  if (session.readySettled) {
    return;
  }
  session.readySettled = true;
  session.resolveReady();
}

function rejectReady(session: SttSession, error: Error): void {
  if (session.readySettled) {
    return;
  }
  session.readySettled = true;
  session.rejectReady(error);
}

function settleCompletion(session: SttSession, transcript: string): void {
  if (session.completionSettled) {
    return;
  }
  session.completionSettled = true;
  session.resolveCompletion(transcript);
}

function rejectCompletion(session: SttSession, error: Error): void {
  if (session.completionSettled) {
    return;
  }
  session.completionSettled = true;
  session.rejectCompletion(error);
}

function cleanupSession(session: SttSession): void {
  if (activeSession === session) {
    activeSession = null;
  }
}

function failSession(session: SttSession, error: Error): void {
  if (!session.error) {
    session.error = error;
  }
  rejectReady(session, error);
  rejectCompletion(session, error);
  try {
    if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
      session.socket.close();
    }
  } finally {
    cleanupSession(session);
  }
}

function flushPendingAudio(session: SttSession): void {
  if (!session.ready || session.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  while (session.pendingAudioChunks.length > 0) {
    const chunk = session.pendingAudioChunks.shift();
    if (!chunk) {
      continue;
    }
    session.socket.send(JSON.stringify({ type: "audio", audio: chunk }));
  }
}

function handleMessage(session: SttSession, raw: RawData): void {
  let parsed: GradiumServerMessage;
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    parsed = JSON.parse(text) as GradiumServerMessage;
  } catch {
    return;
  }

  if (parsed.type === "ready") {
    session.ready = true;
    settleReady(session);
    flushPendingAudio(session);
    if (session.stopRequested && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "end_of_stream" }));
    }
    return;
  }

  if (parsed.type === "text") {
    const segment = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (segment.length > 0) {
      const last = session.transcriptSegments[session.transcriptSegments.length - 1];
      if (last !== segment) {
        session.transcriptSegments.push(segment);
      }
    }
    return;
  }

  if (parsed.type === "error") {
    const message = typeof parsed.message === "string" ? parsed.message : "Unknown Gradium STT error";
    const codeSuffix = typeof parsed.code === "number" ? ` (code ${parsed.code})` : "";
    failSession(session, new Error(`Gradium STT failed${codeSuffix}: ${message}`));
    return;
  }

  if (parsed.type === "end_of_stream") {
    const transcript = session.transcriptSegments.join(" ").trim();
    settleCompletion(session, transcript);
    cleanupSession(session);
    if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
      session.socket.close();
    }
  }
}

function getActiveSession(): SttSession {
  if (!activeSession) {
    throw new Error("No active Gradium STT session.");
  }
  return activeSession;
}

export async function startGradiumSttSession(): Promise<void> {
  if (activeSession) {
    throw new Error("A Gradium STT session is already active.");
  }

  const apiKey = getGradiumApiKey();
  const endpoint = getGradiumEndpoint();

  let resolveReady = (): void => undefined;
  let rejectReady = (_reason: Error): void => undefined;
  let resolveCompletion = (_transcript: string): void => undefined;
  let rejectCompletion = (_reason: Error): void => undefined;

  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const completionPromise = new Promise<string>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const socket = new WebSocket(endpoint, {
    headers: {
      "x-api-key": apiKey
    }
  });

  const session: SttSession = {
    socket,
    ready: false,
    readySettled: false,
    completionSettled: false,
    stopRequested: false,
    transcriptSegments: [],
    pendingAudioChunks: [],
    error: null,
    readyPromise,
    completionPromise,
    resolveReady,
    rejectReady,
    resolveCompletion,
    rejectCompletion
  };

  session.readyPromise.catch(() => undefined);
  session.completionPromise.catch(() => undefined);

  activeSession = session;

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "setup",
        model_name: getGradiumModelName(),
        input_format: "pcm"
      })
    );
  });

  socket.on("message", (raw: RawData) => {
    handleMessage(session, raw);
  });

  socket.on("error", (error: Error) => {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    failSession(session, wrapped);
  });

  socket.on("close", () => {
    if (session.error) {
      cleanupSession(session);
      return;
    }

    if (session.stopRequested) {
      settleCompletion(session, session.transcriptSegments.join(" ").trim());
      cleanupSession(session);
      return;
    }

    failSession(session, new Error("Gradium STT connection closed unexpectedly."));
  });

  return;
}

export function pushGradiumSttAudioChunk(audioBuffer: ArrayBuffer): void {
  const session = getActiveSession();
  if (session.error) {
    throw session.error;
  }

  const base64 = Buffer.from(audioBuffer).toString("base64");
  if (!session.ready || session.socket.readyState !== WebSocket.OPEN) {
    session.pendingAudioChunks.push(base64);
    return;
  }

  session.socket.send(JSON.stringify({ type: "audio", audio: base64 }));
}

export async function stopGradiumSttSession(): Promise<string> {
  const session = getActiveSession();
  if (session.error) {
    cleanupSession(session);
    throw session.error;
  }

  session.stopRequested = true;

  if (session.socket.readyState === WebSocket.OPEN) {
    session.socket.send(JSON.stringify({ type: "end_of_stream" }));
  }

  const transcript = (await session.completionPromise).trim();
  cleanupSession(session);

  if (!transcript) {
    throw new Error("Gradium transcription returned empty text.");
  }

  return transcript;
}
