import { describe, expect, it } from "vitest";
import { EnergyVad } from "../audio/vad";

function tone(
  sampleCount: number,
  amplitude: number,
): Float32Array {
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = Math.sin(i / 8) * amplitude;
  }
  return samples;
}

describe("EnergyVad", () => {
  it("emits an utterance after speech followed by silence", () => {
    const vad = new EnergyVad({
      sampleRate: 16_000,
      speechThreshold: 0.02,
      silenceThreshold: 0.01,
      silenceDurationMs: 100,
      minSpeechMs: 50,
      maxSpeechMs: 5_000,
      preRollMs: 20,
    });

    const frame = 320; // 20ms at 16kHz
    const events: string[] = [];
    let utterance: Float32Array | null = null;

    // Speech for ~200ms
    for (let i = 0; i < 10; i += 1) {
      for (const event of vad.push(tone(frame, 0.2))) {
        events.push(event.type);
        if (event.type === "speech-end") {
          utterance = event.samples;
        }
      }
    }

    // Silence for >100ms
    for (let i = 0; i < 8; i += 1) {
      for (const event of vad.push(tone(frame, 0.001))) {
        events.push(event.type);
        if (event.type === "speech-end") {
          utterance = event.samples;
        }
      }
    }

    expect(events).toContain("speech-start");
    expect(events).toContain("speech-end");
    expect(utterance).not.toBeNull();
    expect(utterance!.length).toBeGreaterThan(0);
  });

  it("ignores short blips below minSpeechMs", () => {
    const vad = new EnergyVad({
      sampleRate: 16_000,
      speechThreshold: 0.02,
      silenceThreshold: 0.01,
      silenceDurationMs: 50,
      minSpeechMs: 300,
      maxSpeechMs: 5_000,
      preRollMs: 0,
    });

    const frame = 160;
    let ended = false;

    for (const event of vad.push(tone(frame, 0.2))) {
      if (event.type === "speech-end") {
        ended = true;
      }
    }
    for (let i = 0; i < 10; i += 1) {
      for (const event of vad.push(tone(frame, 0.001))) {
        if (event.type === "speech-end") {
          ended = true;
        }
      }
    }

    expect(ended).toBe(false);
  });
});
