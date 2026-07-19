import type { CommittedWord } from "../graph/graph-types";
import { normalizeTranscriptWords } from "../transcription/normalization";
import { assignWordTimestamps } from "../transcription/word-timestamps";

/**
 * When true, stream the canned demo on load (clears any persisted graph).
 * Leave false so first entry is paste-or-speak.
 */
export const USE_DEMO_TRANSCRIPT = false;

export const DEMO_TRANSCRIPT = [
  "Memory is a living field of associations.",
  "Words drift toward related ideas like gravity.",
  "When we speak about language cognition and attention the graph tightens.",
  "Semantic similarity pulls concepts into communities while colocation binds nearby phrases.",
  "Thoughtfield turns spoken language into a kinetic map of meaning where activation spreads through connected nodes.",
].join(" ");

export function transcriptToCommittedWords(
  text: string,
  startMs = 0,
  msPerWord = 220,
): CommittedWord[] {
  const pairs = normalizeTranscriptWords(text);
  if (pairs.length === 0) {
    return [];
  }

  const timed = assignWordTimestamps(
    pairs.map((pair) => pair.raw),
    startMs,
    pairs.length * msPerWord,
  );

  return pairs.map((pair, index) => {
    const stamp = timed[index];
    return {
      rawText: pair.raw,
      normalizedText: pair.normalized,
      startTimeMs: stamp?.startMs ?? startMs + index * msPerWord,
      endTimeMs: stamp?.endMs ?? startMs + (index + 1) * msPerWord,
      sequenceIndex: index,
    };
  });
}

export function createDemoSeed(): {
  transcript: string;
  words: CommittedWord[];
} {
  return {
    transcript: DEMO_TRANSCRIPT,
    words: transcriptToCommittedWords(DEMO_TRANSCRIPT),
  };
}
