export type VadConfig = {
  sampleRate: number;
  /** RMS above this starts / continues speech. */
  speechThreshold: number;
  /** RMS below this counts as silence. */
  silenceThreshold: number;
  /** End utterance after this much continuous silence. */
  silenceDurationMs: number;
  /** Ignore blips shorter than this. */
  minSpeechMs: number;
  /** Force-cut long utterances so Whisper stays responsive. */
  maxSpeechMs: number;
  /** Keep this much audio before speech onset. */
  preRollMs: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: 16_000,
  speechThreshold: 0.015,
  silenceThreshold: 0.008,
  silenceDurationMs: 550,
  minSpeechMs: 280,
  maxSpeechMs: 8_000,
  preRollMs: 250,
};

export type VadEvent =
  | { type: "speech-start" }
  | { type: "speech-end"; samples: Float32Array }
  | { type: "speech-continue" };

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

/**
 * Simple energy VAD: buffer while speaking, emit one utterance on silence
 * (or max duration). Same shape as the browser-whisper / HF live-mic demos,
 * without an extra Silero model dependency.
 */
export class EnergyVad {
  private readonly config: VadConfig;
  private readonly preRollSamples: number;
  private readonly silenceSamplesNeeded: number;
  private readonly minSpeechSamples: number;
  private readonly maxSpeechSamples: number;

  private preRoll: Float32Array;
  private preRollWrite = 0;
  private preRollFilled = 0;

  private speaking = false;
  private utteranceChunks: Float32Array[] = [];
  private utteranceLength = 0;
  private silenceSamples = 0;

  constructor(config: Partial<VadConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
    this.preRollSamples = Math.ceil(
      (this.config.sampleRate * this.config.preRollMs) / 1000,
    );
    this.silenceSamplesNeeded = Math.ceil(
      (this.config.sampleRate * this.config.silenceDurationMs) / 1000,
    );
    this.minSpeechSamples = Math.ceil(
      (this.config.sampleRate * this.config.minSpeechMs) / 1000,
    );
    this.maxSpeechSamples = Math.ceil(
      (this.config.sampleRate * this.config.maxSpeechMs) / 1000,
    );
    this.preRoll = new Float32Array(Math.max(1, this.preRollSamples));
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  push(samples: Float32Array): VadEvent[] {
    if (samples.length === 0) {
      return [];
    }

    const events: VadEvent[] = [];
    const level = rms(samples);

    if (!this.speaking) {
      this.pushPreRoll(samples);

      if (level >= this.config.speechThreshold) {
        this.speaking = true;
        this.silenceSamples = 0;
        this.utteranceChunks = [this.snapshotPreRoll(), new Float32Array(samples)];
        this.utteranceLength =
          this.utteranceChunks[0]!.length + samples.length;
        events.push({ type: "speech-start" });
      }
      return events;
    }

    // Speaking
    this.utteranceChunks.push(new Float32Array(samples));
    this.utteranceLength += samples.length;
    events.push({ type: "speech-continue" });

    if (level <= this.config.silenceThreshold) {
      this.silenceSamples += samples.length;
    } else {
      this.silenceSamples = 0;
    }

    const hitSilence = this.silenceSamples >= this.silenceSamplesNeeded;
    const hitMax = this.utteranceLength >= this.maxSpeechSamples;

    if (hitSilence || hitMax) {
      const utterance = this.finishUtterance();
      if (utterance) {
        events.push({ type: "speech-end", samples: utterance });
      }
    }

    return events;
  }

  flush(): Float32Array | null {
    if (!this.speaking) {
      this.resetUtterance();
      return null;
    }
    return this.finishUtterance();
  }

  reset(): void {
    this.speaking = false;
    this.silenceSamples = 0;
    this.resetUtterance();
    this.preRollWrite = 0;
    this.preRollFilled = 0;
    this.preRoll.fill(0);
  }

  private finishUtterance(): Float32Array | null {
    const speechSamples = Math.max(
      0,
      this.utteranceLength - this.silenceSamples,
    );
    const tooShort = speechSamples < this.minSpeechSamples;
    const samples = this.concatChunks(this.utteranceChunks, this.utteranceLength);
    this.speaking = false;
    this.silenceSamples = 0;
    this.resetUtterance();
    this.preRollWrite = 0;
    this.preRollFilled = 0;
    this.preRoll.fill(0);

    if (tooShort || samples.length === 0) {
      return null;
    }
    return samples;
  }

  private resetUtterance(): void {
    this.utteranceChunks = [];
    this.utteranceLength = 0;
  }

  private pushPreRoll(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      this.preRoll[this.preRollWrite] = samples[i]!;
      this.preRollWrite = (this.preRollWrite + 1) % this.preRoll.length;
      this.preRollFilled = Math.min(
        this.preRollFilled + 1,
        this.preRoll.length,
      );
    }
  }

  private snapshotPreRoll(): Float32Array {
    const n = this.preRollFilled;
    const result = new Float32Array(n);
    const start =
      (this.preRollWrite - n + this.preRoll.length) % this.preRoll.length;
    for (let i = 0; i < n; i += 1) {
      result[i] = this.preRoll[(start + i) % this.preRoll.length]!;
    }
    return result;
  }

  private concatChunks(chunks: Float32Array[], length: number): Float32Array {
    const result = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
