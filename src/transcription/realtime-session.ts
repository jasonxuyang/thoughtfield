/**
 * Realtime ASR session adapted from nico-martin/realtime-captions +
 * Hugging Face realtime-whisper-webgpu:
 *
 * - MediaRecorder accumulates audio chunks on the main thread
 * - Worker runs one Whisper generate() at a time on the pending window
 * - LocalAgreement commits stable hypotheses into an archive
 */

import { ASR_CONFIG } from "../config/algorithms";
import type { CommittedWord } from "../graph/graph-types";
import type { AsrWorkerOut, ModelLoadProgress } from "../workers/worker-messages";
import { getAudioFromChunks } from "./audio-from-chunks";
import {
  applyLocalAgreement,
  committedText,
  createAgreementState,
  flushAgreement,
  type AgreementState,
} from "./local-agreement";
import { normalizeToken, tokenizeTranscript } from "./normalization";
import { assignWordTimestamps } from "./word-timestamps";

import AsrWorker from "../workers/asr.worker.ts?worker";

export type RealtimeSessionOutput = {
  committed: string;
  pending: string;
  graphWords: CommittedWord[];
};

export type RealtimeSessionCallbacks = {
  onProgress: (progress: ModelLoadProgress) => void;
  onOutput: (output: RealtimeSessionOutput) => void;
  onError: (message: string) => void;
};

function rms(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]!;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export class RealtimeAsrSession {
  private readonly worker: Worker;
  private readonly callbacks: RealtimeSessionCallbacks;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private chunks: Blob[] = [];
  private recording = false;
  private modelReady = false;
  private modelBusy = false;
  private agreement: AgreementState = createAgreementState();
  private sequenceIndex = 0;
  private pendingRequest: { id: string; audioLength: number } | null = null;
  private maxSamples: number;

  constructor(callbacks: RealtimeSessionCallbacks) {
    this.callbacks = callbacks;
    this.maxSamples = Math.ceil(
      (ASR_CONFIG.sampleRate * ASR_CONFIG.maxBufferMs) / 1000,
    );
    this.worker = new AsrWorker();
    this.worker.onmessage = (event: MessageEvent<AsrWorkerOut>) => {
      this.onWorkerMessage(event.data);
    };
  }

  get ready(): boolean {
    return this.modelReady;
  }

  /** Live mic stream while recording — for waveform / level meters. */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  init(): void {
    this.worker.postMessage({ type: "init" });
  }

  async start(): Promise<void> {
    if (!this.modelReady) {
      throw new Error("Transcription model is not ready");
    }
    if (this.recording) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.audioContext = new AudioContext({ sampleRate: ASR_CONFIG.sampleRate });
    this.recorder = new MediaRecorder(this.stream);
    this.chunks = [];

    this.recorder.onstart = () => {
      this.recording = true;
      this.recorder?.requestData();
    };

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
        void this.maybeProcess();
      } else if (this.recording) {
        window.setTimeout(() => this.recorder?.requestData(), 25);
      }
    };

    this.recorder.onstop = () => {
      this.recording = false;
    };

    this.recorder.start();
  }

  stop(): void {
    // Mark stopped first so in-flight async passes bail out cleanly.
    this.recording = false;
    this.pendingRequest = null;
    this.modelBusy = false;

    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    const flushed = flushAgreement(this.agreement);
    this.agreement = flushed.state;
    this.emit(flushed.newlyCommitted ? [flushed.newlyCommitted] : []);
  }

  reset(): void {
    this.stop();
    this.chunks = [];
    this.agreement = createAgreementState();
    this.sequenceIndex = 0;
    this.emit([]);
  }

  destroy(): void {
    this.stop();
    void this.audioContext?.close();
    this.audioContext = null;
    this.worker.terminate();
  }

  private onWorkerMessage(message: AsrWorkerOut): void {
    switch (message.type) {
      case "progress":
        this.modelReady = message.progress.status === "ready";
        this.callbacks.onProgress(message.progress);
        break;
      case "complete": {
        if (
          !this.pendingRequest ||
          message.requestId !== this.pendingRequest.id
        ) {
          break;
        }
        const audioLength = this.pendingRequest.audioLength;
        this.pendingRequest = null;
        this.modelBusy = false;
        this.handleHypothesis(message.text, audioLength);
        break;
      }
      case "error":
        if (
          message.requestId &&
          this.pendingRequest?.id === message.requestId
        ) {
          this.pendingRequest = null;
          this.modelBusy = false;
        }
        this.callbacks.onError(message.message);
        this.requestMoreAudio();
        break;
      default: {
        const _exhaustive: never = message;
        void _exhaustive;
        break;
      }
    }
  }

  private requestMoreAudio(): void {
    if (!this.recording || !this.recorder || this.recorder.state === "inactive") {
      return;
    }
    this.recorder.requestData();
  }

  private async maybeProcess(): Promise<void> {
    if (!this.recording || !this.modelReady || this.modelBusy) {
      return;
    }

    const recorder = this.recorder;
    const audioContext = this.audioContext;
    if (!recorder || !audioContext || this.chunks.length === 0) {
      this.requestMoreAudio();
      return;
    }

    try {
      const fullAudio = await getAudioFromChunks(
        this.chunks,
        recorder.mimeType,
        audioContext,
      );

      // stop() may have run during decode — abandon this pass quietly.
      if (!this.recording || this.recorder !== recorder) {
        return;
      }

      if (fullAudio.length - this.agreement.cutSample > this.maxSamples) {
        this.agreement = {
          ...this.agreement,
          cutSample: fullAudio.length - this.maxSamples,
        };
      }

      const pending = fullAudio.subarray(this.agreement.cutSample);
      const minSamples = Math.ceil(
        (ASR_CONFIG.sampleRate * ASR_CONFIG.minAudioMs) / 1000,
      );
      if (pending.length < minSamples || rms(pending) < ASR_CONFIG.silenceRms) {
        this.requestMoreAudio();
        return;
      }

      const audio = pending.slice();
      const requestId = crypto.randomUUID();
      this.pendingRequest = { id: requestId, audioLength: fullAudio.length };
      this.modelBusy = true;
      this.worker.postMessage({ type: "generate", requestId, audio }, [
        audio.buffer,
      ]);
    } catch (error) {
      this.modelBusy = false;
      if (!this.recording) {
        return;
      }
      this.callbacks.onError(
        error instanceof Error ? error.message : String(error),
      );
      this.requestMoreAudio();
    }
  }

  private handleHypothesis(text: string, audioLength: number): void {
    const result = applyLocalAgreement(
      this.agreement,
      text,
      audioLength,
      ASR_CONFIG.agreementCount,
    );
    this.agreement = result.state;
    this.emit(result.newlyCommitted ? [result.newlyCommitted] : []);
    this.requestMoreAudio();
  }

  private emit(newSegments: string[]): void {
    const graphWords = newSegments.flatMap((segment) =>
      this.segmentToGraphWords(segment),
    );
    this.callbacks.onOutput({
      committed: committedText(this.agreement),
      pending: this.agreement.tempOutput,
      graphWords,
    });
  }

  private segmentToGraphWords(segment: string): CommittedWord[] {
    const tokens = tokenizeTranscript(segment);
    const timed = assignWordTimestamps(
      tokens,
      performance.now(),
      Math.max(200, tokens.length * 200),
    );
    const words: CommittedWord[] = [];
    for (const word of timed) {
      const normalized = normalizeToken(word.text);
      if (!normalized) {
        this.sequenceIndex += 1;
        continue;
      }
      words.push({
        rawText: word.text,
        normalizedText: normalized,
        startTimeMs: word.startMs ?? 0,
        endTimeMs: word.endMs ?? word.startMs ?? 0,
        sequenceIndex: this.sequenceIndex,
      });
      this.sequenceIndex += 1;
    }
    return words;
  }
}
