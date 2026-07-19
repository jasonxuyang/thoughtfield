import type { TranscriptWord } from "./stable-prefix";

export type TimedChunk = {
  text: string;
  startMs: number;
  endMs: number;
};

/**
 * Prefer Whisper word timestamps when available; otherwise approximate
 * evenly across the audio window.
 */
export function assignWordTimestamps(
  words: string[],
  windowStartMs: number,
  windowDurationMs: number,
  whisperChunks?: TimedChunk[],
): TranscriptWord[] {
  if (whisperChunks && whisperChunks.length > 0) {
    const result: TranscriptWord[] = [];
    for (const chunk of whisperChunks) {
      const parts = chunk.text.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        continue;
      }

      const span = Math.max(1, chunk.endMs - chunk.startMs);
      const step = span / parts.length;

      for (let i = 0; i < parts.length; i += 1) {
        result.push({
          text: parts[i]!,
          startMs: chunk.startMs + i * step,
          endMs: chunk.startMs + (i + 1) * step,
        });
      }
    }

    if (result.length > 0) {
      return result;
    }
  }

  if (words.length === 0) {
    return [];
  }

  const step = windowDurationMs / words.length;
  return words.map((text, index) => ({
    text,
    startMs: windowStartMs + index * step,
    endMs: windowStartMs + (index + 1) * step,
  }));
}
