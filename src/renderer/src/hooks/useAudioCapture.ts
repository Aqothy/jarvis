import { useCallback, useRef, useState, type MutableRefObject } from "react";
import pcmWorkletUrl from "../pcm-capture.worklet.js?url";

const TARGET_SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 1920;

export type CaptureState = "idle" | "recording" | "transcribing";

interface SttBridge {
  startSttSession: () => Promise<void>;
  pushSttAudioChunk: (buffer: ArrayBuffer) => void;
  stopSttSession: () => Promise<{ transcript: string }>;
}

interface UseAudioCaptureReturn {
  captureState: CaptureState;
  captureStateRef: MutableRefObject<CaptureState>;
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<string>;
  teardown: (options?: { closeContext?: boolean }) => Promise<void>;
}

function downsampleToTarget(
  input: Float32Array,
  inputSampleRate: number,
): Float32Array {
  if (inputSampleRate === TARGET_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.round(i * ratio);
    const end = Math.min(Math.round((i + 1) * ratio), input.length);

    let sum = 0;
    for (let j = start; j < end; j += 1) {
      sum += input[j];
    }

    output[i] = end > start ? sum / (end - start) : 0;
  }

  return output;
}

function toPcm16Buffer(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const output = new Int16Array(buffer);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 32768 : sample * 32767;
  }

  return buffer;
}

export function useAudioCapture(bridge: SttBridge): UseAudioCaptureReturn {
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const captureStateRef = useRef<CaptureState>("idle");

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sinkGainRef = useRef<GainNode | null>(null);

  const pcmBufferRef = useRef(new Float32Array(FRAME_SAMPLES));
  const pcmBufferIndexRef = useRef(0);
  const workletLoadedRef = useRef(false);

  const updateState = useCallback((next: CaptureState): void => {
    captureStateRef.current = next;
    setCaptureState(next);
  }, []);

  const appendAndEmitFrames = useCallback(
    (samples24k: Float32Array): void => {
      let inputOffset = 0;
      const buffer = pcmBufferRef.current;

      while (inputOffset < samples24k.length) {
        const remainingInBuffer = FRAME_SAMPLES - pcmBufferIndexRef.current;
        const toCopy = Math.min(
          remainingInBuffer,
          samples24k.length - inputOffset,
        );

        buffer.set(
          samples24k.subarray(inputOffset, inputOffset + toCopy),
          pcmBufferIndexRef.current,
        );

        pcmBufferIndexRef.current += toCopy;
        inputOffset += toCopy;

        if (pcmBufferIndexRef.current === FRAME_SAMPLES) {
          bridge.pushSttAudioChunk(toPcm16Buffer(buffer));
          pcmBufferIndexRef.current = 0;
        }
      }
    },
    [bridge],
  );

  const teardown = useCallback(
    async (options?: { closeContext?: boolean }): Promise<void> => {
      const workletNode = workletNodeRef.current;
      const sourceNode = sourceNodeRef.current;
      const sinkGain = sinkGainRef.current;
      const audioContext = audioContextRef.current;
      const stream = streamRef.current;

      if (workletNode) {
        workletNode.port.onmessage = null;
        workletNode.disconnect();
        workletNodeRef.current = null;
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

      pcmBufferIndexRef.current = 0;

      if (audioContext && options?.closeContext) {
        audioContextRef.current = null;
        workletLoadedRef.current = false;
        await audioContext.close().catch(() => undefined);
      }
    },
    [],
  );

  const startCapture = useCallback(async (): Promise<void> => {
    if (captureStateRef.current !== "idle") {
      return;
    }

    updateState("recording");

    const sttStartPromise = bridge.startSttSession();
    let sttStarted = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === "closed") {
        audioContext = new AudioContext({ latencyHint: "interactive" });
        audioContextRef.current = audioContext;
        workletLoadedRef.current = false;
      }

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(stream);

      if (!workletLoadedRef.current) {
        await audioContext.audioWorklet.addModule(pcmWorkletUrl);
        workletLoadedRef.current = true;
      }

      const workletNode = new AudioWorkletNode(
        audioContext,
        "pcm-capture-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
        },
      );

      const sinkGain = audioContext.createGain();
      sinkGain.gain.value = 0;

      sourceNode.connect(workletNode);
      workletNode.connect(sinkGain);
      sinkGain.connect(audioContext.destination);

      const capturedSampleRate = audioContext.sampleRate;

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (captureStateRef.current !== "recording") {
          return;
        }
        if (!(event.data instanceof Float32Array)) {
          return;
        }

        appendAndEmitFrames(downsampleToTarget(event.data, capturedSampleRate));
      };

      streamRef.current = stream;
      sourceNodeRef.current = sourceNode;
      workletNodeRef.current = workletNode;
      sinkGainRef.current = sinkGain;
      pcmBufferIndexRef.current = 0;

      await sttStartPromise;
      sttStarted = true;
    } catch (err) {
      await teardown();
      try {
        await sttStartPromise;
        sttStarted = true;
      } catch {
        sttStarted = false;
      }
      if (sttStarted) {
        await bridge.stopSttSession().catch(() => undefined);
      }
      updateState("idle");
      throw err;
    }
  }, [appendAndEmitFrames, bridge, teardown, updateState]);

  const stopCapture = useCallback(async (): Promise<string> => {
    if (captureStateRef.current !== "recording") {
      return "";
    }

    updateState("transcribing");

    if (pcmBufferIndexRef.current > 0) {
      bridge.pushSttAudioChunk(
        toPcm16Buffer(
          pcmBufferRef.current.subarray(0, pcmBufferIndexRef.current),
        ),
      );
      pcmBufferIndexRef.current = 0;
    }

    const sttResultPromise = bridge.stopSttSession();
    const teardownPromise = teardown();

    try {
      const sttResult = await sttResultPromise;
      return sttResult.transcript.trim();
    } finally {
      await teardownPromise.catch(() => undefined);
      updateState("idle");
    }
  }, [bridge, teardown, updateState]);

  return {
    captureState,
    captureStateRef,
    startCapture,
    stopCapture,
    teardown,
  };
}
