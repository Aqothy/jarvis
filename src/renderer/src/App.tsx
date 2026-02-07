import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextSnapshot, ImageTaskResult, PermissionStatus, TextTaskResult } from "../../main/types";

type RunState = "idle" | "recording" | "transcribing" | "running_text" | "running_image" | "error";
const TARGET_SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 1920;

const INITIAL_PERMISSIONS: PermissionStatus = {
  microphone: false,
  accessibility: false
};

const BACKLOG_ITEMS = [
  "Wake word ('Jarvis') + background listening",
  "Screenshot context mode",
  "Calendar and SaaS connectors",
  "Grounded search",
  "Browser automation",
  "Sensitive action approvals",
  "Advanced model routing"
];

export function App(): JSX.Element {
  const bridge = window.jarvis;
  const [permissions, setPermissions] = useState<PermissionStatus>(INITIAL_PERMISSIONS);
  const [contextPreview, setContextPreview] = useState<ContextSnapshot | null>(null);
  const [instruction, setInstruction] = useState("Make this message concise and professional.");
  const [transcript, setTranscript] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [textResult, setTextResult] = useState<TextTaskResult | null>(null);
  const [imageResult, setImageResult] = useState<ImageTaskResult | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const sinkGainRef = useRef<GainNode | null>(null);
  const pcmRemainderRef = useRef<Float32Array>(new Float32Array(0));
  const transcriptBufferRef = useRef("");
  const runStateRef = useRef<RunState>("idle");

  const busy = runState !== "idle" && runState !== "error";
  const currentContext = useMemo(() => textResult?.context || imageResult?.context || contextPreview, [
    textResult,
    imageResult,
    contextPreview
  ]);

  function setRunStateNow(next: RunState): void {
    runStateRef.current = next;
    setRunState(next);
  }

  async function refreshPermissions(): Promise<void> {
    if (!bridge) {
      throw new Error("Preload bridge unavailable. Restart app after rebuilding main/preload.");
    }
    const status = await bridge.getPermissionStatus();
    setPermissions(status);
  }

  async function refreshContextPreview(): Promise<void> {
    try {
      if (!bridge) {
        throw new Error("Preload bridge unavailable. Restart app after rebuilding main/preload.");
      }
      const snapshot = await bridge.captureContextPreview();
      setContextPreview(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture context preview.");
    }
  }

  useEffect(() => {
    runStateRef.current = runState;
  }, [runState]);

  useEffect(() => {
    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    refreshPermissions().catch(() => undefined);
    refreshContextPreview().catch(() => undefined);
    const unsubscribe = bridge.onPushToTalkShortcut(() => {
      if (runStateRef.current === "recording") {
        stopRecording().catch(() => undefined);
      } else if (runStateRef.current === "idle" || runStateRef.current === "error") {
        startRecording().catch(() => undefined);
      }
    });
    return () => {
      unsubscribe();
      teardownAudioCapture().catch(() => undefined);
    };
  }, []);

  function downsampleToTarget(input: Float32Array, inputSampleRate: number): Float32Array {
    if (inputSampleRate === TARGET_SAMPLE_RATE) {
      return input;
    }

    const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    let outputIndex = 0;
    let inputOffset = 0;
    while (outputIndex < outputLength) {
      const nextInputOffset = Math.round((outputIndex + 1) * ratio);
      let sum = 0;
      let count = 0;

      for (let i = inputOffset; i < nextInputOffset && i < input.length; i += 1) {
        sum += input[i];
        count += 1;
      }

      output[outputIndex] = count > 0 ? sum / count : 0;
      outputIndex += 1;
      inputOffset = nextInputOffset;
    }

    return output;
  }

  function toPcm16Buffer(input: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      const value = sample < 0 ? sample * 32768 : sample * 32767;
      view.setInt16(i * 2, value, true);
    }
    return buffer;
  }

  function appendAndEmitFrames(samples24k: Float32Array): void {
    const previous = pcmRemainderRef.current;
    const merged = new Float32Array(previous.length + samples24k.length);
    merged.set(previous, 0);
    merged.set(samples24k, previous.length);

    let offset = 0;
    while (merged.length - offset >= FRAME_SAMPLES) {
      const frame = merged.slice(offset, offset + FRAME_SAMPLES);
      bridge.pushSttAudioChunk(toPcm16Buffer(frame));
      offset += FRAME_SAMPLES;
    }

    pcmRemainderRef.current = merged.slice(offset);
  }

  async function teardownAudioCapture(options?: { awaitContextClose?: boolean }): Promise<void> {
    const processor = processorNodeRef.current;
    const sourceNode = sourceNodeRef.current;
    const sinkGain = sinkGainRef.current;
    const audioContext = audioContextRef.current;
    const stream = streamRef.current;

    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processorNodeRef.current = null;
    }

    if (sourceNode) {
      sourceNode.disconnect();
      sourceNodeRef.current = null;
    }

    if (sinkGain) {
      sinkGain.disconnect();
      sinkGainRef.current = null;
    }

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContext) {
      const closePromise = audioContext.close();
      audioContextRef.current = null;
      if (options?.awaitContextClose === false) {
        closePromise.catch(() => undefined);
      } else {
        await closePromise;
      }
    }
  }

  async function processTranscriptInstruction(): Promise<void> {
    const transcriptValue = transcriptBufferRef.current.trim();
    if (!transcriptValue) {
      setRunStateNow("idle");
      return;
    }

    setRunStateNow("running_text");
    const textTaskResult = await bridge.runTextTask({ instruction: transcriptValue });
    setTextResult(textTaskResult);
    setImageResult(null);
    refreshContextPreview().catch(() => undefined);
    setRunStateNow("idle");
  }

  async function startRecording(): Promise<void> {
    setError(null);
    setTextResult(null);
    setImageResult(null);

    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    // Set recording state immediately so UI responds instantly
    setRunStateNow("recording");

    refreshPermissions().catch(() => undefined);

    const sttStartPromise = bridge.startSttSession();
    let sttStarted = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error("AudioContext is unavailable in this environment.");
      }

      const audioContext = new AudioContextCtor({ latencyHint: "interactive" });
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      const sinkGain = audioContext.createGain();
      sinkGain.gain.value = 0;

      sourceNode.connect(processor);
      processor.connect(sinkGain);
      sinkGain.connect(audioContext.destination);

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        if (runStateRef.current !== "recording") {
          return;
        }

        const input = event.inputBuffer.getChannelData(0);
        const mono = new Float32Array(input.length);
        mono.set(input);
        const downsampled = downsampleToTarget(mono, event.inputBuffer.sampleRate);
        appendAndEmitFrames(downsampled);
      };

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      processorNodeRef.current = processor;
      sinkGainRef.current = sinkGain;
      pcmRemainderRef.current = new Float32Array(0);
      transcriptBufferRef.current = "";
      setTranscript("");

      // Don't block on STT ready — audio chunks are queued in the service until ready
      sttStartPromise.then(() => { sttStarted = true; }).catch(() => undefined);
    } catch (err) {
      await teardownAudioCapture({ awaitContextClose: false });
      try {
        await sttStartPromise;
        sttStarted = true;
      } catch {
      }
      if (sttStarted) {
        try {
          await bridge.stopSttSession();
        } catch {
        }
      }
      setRunStateNow("error");
      setError(err instanceof Error ? err.message : "Unable to start Gradium transcription.");
    }
  }

  async function stopRecording(): Promise<void> {
    if (runStateRef.current !== "recording") {
      return;
    }

    setRunStateNow("transcribing");

    try {
      if (pcmRemainderRef.current.length > 0) {
        bridge.pushSttAudioChunk(toPcm16Buffer(pcmRemainderRef.current));
        pcmRemainderRef.current = new Float32Array(0);
      }

      // Fire-and-forget teardown — don't block transcript retrieval on AudioContext.close()
      const sttResultPromise = bridge.stopSttSession();
      teardownAudioCapture({ awaitContextClose: false }).catch(() => undefined);
      const sttResult = await sttResultPromise;
      const transcriptValue = sttResult.transcript.trim();
      transcriptBufferRef.current = transcriptValue;
      setTranscript(transcriptValue);

      await processTranscriptInstruction();
    } catch (err) {
      setRunStateNow("error");
      setError(err instanceof Error ? err.message : "Gradium transcription failed.");
    }
  }

  async function requestAccessibility(): Promise<void> {
    if (!bridge) {
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    const granted = await bridge.requestAccessibilityPermission();
    if (!granted) {
      setError("Accessibility permission is required for reliable cursor insertion.");
    }
    await refreshPermissions();
  }

  async function executeTextTask(): Promise<void> {
    setError(null);
    setImageResult(null);
    setTextResult(null);
    if (!bridge) {
      setRunStateNow("error");
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    setRunStateNow("running_text");
    try {
      const result = await bridge.runTextTask({ instruction });
      setTextResult(result);
      setRunStateNow("idle");
    } catch (err) {
      setRunStateNow("error");
      setError(err instanceof Error ? err.message : "Text task failed.");
    } finally {
      await refreshContextPreview();
    }
  }

  async function executeImageTask(): Promise<void> {
    setError(null);
    setTextResult(null);
    setImageResult(null);
    if (!bridge) {
      setRunStateNow("error");
      setError("Preload bridge unavailable. Close and restart the app.");
      return;
    }

    setRunStateNow("running_image");
    try {
      const result = await bridge.runImageTask({ instruction });
      setImageResult(result);
      setRunStateNow("idle");
    } catch (err) {
      setRunStateNow("error");
      setError(err instanceof Error ? err.message : "Image task failed.");
    } finally {
      await refreshContextPreview();
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="kicker">Jarvis MVP</p>
        <h1>Clipboard-First Desktop Assistant</h1>
        <p className="subhead">
          Gradium streaming speech-to-text drives clipboard text/image workflows, then active app metadata. Screenshot
          context stays off in this phase.
        </p>
      </section>

      <section className="panel row">
        <div className="panel-block">
          <h2>Permissions</h2>
          <p>Microphone: {permissions.microphone ? "granted" : "missing"}</p>
          <p>Accessibility: {permissions.accessibility ? "granted" : "missing"}</p>
          <div className="button-row">
            <button onClick={refreshPermissions}>Refresh</button>
            <button onClick={requestAccessibility}>Request Accessibility</button>
          </div>
        </div>
        <div className="panel-block">
          <h2>Push To Talk (Gradium)</h2>
          <p>Click to start/stop transcription. Shortcut: Option+Space.</p>
          <div className="button-row">
            <button
              className={runState === "recording" ? "recording" : ""}
              onClick={runState === "recording" ? stopRecording : startRecording}
              disabled={busy && runState !== "recording"}
            >
              {runState === "recording" ? "Stop Recording" : "Start Recording"}
            </button>
          </div>
          <p className="mono">{transcript || "Transcript will appear here."}</p>
        </div>
      </section>

      <section className="panel">
        <h2>Instruction</h2>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe what you want to do with clipboard text or image..."
          rows={5}
        />
        <div className="button-row">
          <button onClick={executeTextTask} disabled={busy || !instruction.trim()}>
            Run Text Task
          </button>
          <button onClick={executeImageTask} disabled={busy || !instruction.trim()}>
            Run Image Task
          </button>
          <button onClick={refreshContextPreview}>Refresh Context Preview</button>
        </div>
      </section>

      {error && (
        <section className="panel error">
          <h2>Error</h2>
          <p>{error}</p>
        </section>
      )}

      <section className="panel row">
        <div className="panel-block">
          <h2>Result</h2>
          {textResult && (
            <>
              <p>
                Inserted: <strong>{textResult.inserted ? "yes" : "no (clipboard fallback)"}</strong>
              </p>
              <h3>Transformed Text</h3>
              <pre>{textResult.transformedText}</pre>
            </>
          )}
          {imageResult && (
            <>
              <p>Image processed and copied to clipboard.</p>
              <p className="mono">{imageResult.outputImagePath}</p>
            </>
          )}
          {!textResult && !imageResult && <p>No task output yet.</p>}
        </div>

        <div className="panel-block">
          <h2>Context Snapshot</h2>
          <pre>{currentContext ? JSON.stringify(currentContext, null, 2) : "No context captured yet."}</pre>
        </div>
      </section>

      <section className="panel">
        <h2>Deferred TODO</h2>
        <ul>
          {BACKLOG_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
