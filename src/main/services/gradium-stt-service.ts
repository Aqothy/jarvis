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

interface SttSession {
  socket: WebSocket;
  ready: boolean;
  stopRequested: boolean;
  transcriptSegments: string[];
  pendingAudioChunks: string[];
  error: Error | null;
  /** Resolves once the server sends a "ready" message. */
  readyPromise: Promise<void>;
  /** Resolves with the final transcript once the session ends. */
  completionPromise: Promise<string>;
  resolveReady: () => void;
  rejectReady: (reason: Error) => void;
  resolveCompletion: (transcript: string) => void;
  rejectCompletion: (reason: Error) => void;
  readySettled: boolean;
  completionSettled: boolean;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let activeSession: SttSession | null = null;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getGradiumApiKey(): string {
  const key = process.env.GRADIUM_API_KEY;
  if (!key) {
    throw new Error("GRADIUM_API_KEY is not set. Add it to your environment before using STT.");
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
// Session lifecycle helpers
// ---------------------------------------------------------------------------

/** Safely resolve/reject a one-shot deferred, ignoring duplicate calls. */
function settleOnce<T>(
  session: SttSession,
  field: "ready" | "completion",
  action: "resolve" | "reject",
  value: T,
): void {
  const settledKey = field === "ready" ? "readySettled" : "completionSettled";
  if (session[settledKey]) return;
  session[settledKey] = true;

  if (field === "ready") {
    action === "resolve"
      ? session.resolveReady()
      : session.rejectReady(value as Error);
  } else {
    action === "resolve"
      ? session.resolveCompletion(value as string)
      : session.rejectCompletion(value as Error);
  }
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
  settleOnce(session, "ready", "reject", error);
  settleOnce(session, "completion", "reject", error);
  try {
    const { readyState } = session.socket;
    if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
      session.socket.close();
    }
  } finally {
    cleanupSession(session);
  }
}

function flushPendingAudio(session: SttSession): void {
  if (!session.ready || session.socket.readyState !== WebSocket.OPEN) return;

  while (session.pendingAudioChunks.length > 0) {
    const chunk = session.pendingAudioChunks.shift()!;
    session.socket.send(JSON.stringify({ type: "audio", audio: chunk }));
  }
}

function buildTranscript(session: SttSession): string {
  return session.transcriptSegments.join(" ").trim();
}

// ---------------------------------------------------------------------------
// WebSocket message handler
// ---------------------------------------------------------------------------

function handleMessage(session: SttSession, raw: RawData): void {
  let parsed: GradiumServerMessage;
  try {
    parsed = JSON.parse(String(raw)) as GradiumServerMessage;
  } catch {
    return; // Ignore unparseable frames.
  }

  switch (parsed.type) {
    case "ready":
      session.ready = true;
      settleOnce(session, "ready", "resolve", undefined);
      flushPendingAudio(session);
      // If stop was requested before the socket became ready, signal end now.
      if (session.stopRequested && session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({ type: "end_of_stream" }));
      }
      break;

    case "text": {
      const segment = typeof parsed.text === "string" ? parsed.text.trim() : "";
      if (segment.length > 0) {
        const last = session.transcriptSegments[session.transcriptSegments.length - 1];
        if (last !== segment) {
          session.transcriptSegments.push(segment);
        }
      }
      break;
    }

    case "error": {
      const msg = typeof parsed.message === "string" ? parsed.message : "Unknown Gradium STT error";
      const suffix = typeof parsed.code === "number" ? ` (code ${parsed.code})` : "";
      failSession(session, new Error(`Gradium STT failed${suffix}: ${msg}`));
      break;
    }

    case "end_of_stream":
      settleOnce(session, "completion", "resolve", buildTranscript(session));
      cleanupSession(session);
      if (session.socket.readyState === WebSocket.OPEN || session.socket.readyState === WebSocket.CONNECTING) {
        session.socket.close();
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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

  // Build one-shot deferreds for ready and completion signals.
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  let resolveCompletion!: (transcript: string) => void;
  let rejectCompletion!: (reason: Error) => void;

  const readyPromise = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const completionPromise = new Promise<string>((res, rej) => {
    resolveCompletion = res;
    rejectCompletion = rej;
  });

  const socket = new WebSocket(endpoint, {
    headers: { "x-api-key": apiKey },
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
    rejectCompletion,
  };

  // Prevent unhandled rejection warnings -- callers consume these promises.
  readyPromise.catch(() => undefined);
  completionPromise.catch(() => undefined);

  activeSession = session;

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "setup",
        model_name: getGradiumModelName(),
        input_format: "pcm",
      }),
    );
  });

  socket.on("message", (raw: RawData) => handleMessage(session, raw));

  socket.on("error", (err: Error) => failSession(session, err));

  socket.on("close", () => {
    if (session.error) {
      cleanupSession(session);
      return;
    }
    if (session.stopRequested) {
      settleOnce(session, "completion", "resolve", buildTranscript(session));
      cleanupSession(session);
      return;
    }
    failSession(session, new Error("Gradium STT connection closed unexpectedly."));
  });
}

export function pushGradiumSttAudioChunk(audioBuffer: ArrayBuffer): void {
  const session = getActiveSession();
  if (session.error) throw session.error;

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
  return transcript;
}
