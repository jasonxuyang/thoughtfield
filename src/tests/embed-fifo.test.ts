import { describe, expect, it } from "vitest";
import { CONTEXT_CONFIG } from "../config/algorithms";
import { GraphStore } from "../graph/graph-store";
import type { CommittedWord } from "../graph/graph-types";

function wordsFromText(text: string, startMs = 0): CommittedWord[] {
  return text.split(/\s+/).map((token, index) => ({
    rawText: token,
    normalizedText: token.toLowerCase(),
    startTimeMs: startMs + index * 200,
    endTimeMs: startMs + index * 200 + 150,
    sequenceIndex: index,
  }));
}

function fakeEmbedding(seed: number): Float32Array {
  const vector = new Float32Array(8);
  vector[seed % 8] = 1;
  return vector;
}

describe("embed FIFO ordering", () => {
  it("only releases a contiguous ready prefix, never skipping the head", () => {
    const store = new GraphStore();
    // wordsAfter trailing context: with N words, indices 0..N-1-wordsAfter are ready.
    const count = CONTEXT_CONFIG.wordsAfter + 4;
    const labels = Array.from({ length: count }, (_, i) => `w${i}`).join(" ");
    store.ingestCommittedWords(wordsFromText(labels));

    const ready = store.collectReadyContexts(Date.now(), 10);
    expect(ready.map((item) => item.occurrenceId)).toEqual(
      store.occurrences.slice(0, 4).map((item) => item.id),
    );
  });

  it("waits for in-flight embeddings before releasing the next batch", () => {
    const store = new GraphStore();
    const count = CONTEXT_CONFIG.wordsAfter + 6;
    const labels = Array.from({ length: count }, (_, i) => `w${i}`).join(" ");
    store.ingestCommittedWords(wordsFromText(labels));

    const first = store.collectReadyContexts(Date.now(), 3);
    expect(first).toHaveLength(3);

    // Still in flight — do not start the next occurrences yet.
    expect(store.collectReadyContexts(Date.now(), 3)).toEqual([]);

    for (const item of first) {
      store.applyEmbedding(item.occurrenceId, fakeEmbedding(0));
    }

    const second = store.collectReadyContexts(Date.now(), 3);
    expect(second).toHaveLength(3);
    expect(second[0]?.occurrenceId).toBe(store.occurrences[3]?.id);
  });

  it("tracks embeddedOccurrencePrefix in speech order", () => {
    const store = new GraphStore();
    store.ingestCommittedWords(wordsFromText("alpha beta gamma delta"));

    // Force readiness via timeout so we are not blocked on trailing context.
    const ready = store.collectReadyContexts(
      Date.now() + CONTEXT_CONFIG.maxWaitForFutureContextMs + 1,
      2,
    );
    expect(ready).toHaveLength(2);
    expect(store.toSnapshot().embeddedOccurrencePrefix).toBe(0);

    store.applyEmbedding(ready[0]!.occurrenceId, fakeEmbedding(1));
    expect(store.toSnapshot().embeddedOccurrencePrefix).toBe(1);

    store.applyEmbedding(ready[1]!.occurrenceId, fakeEmbedding(2));
    expect(store.toSnapshot().embeddedOccurrencePrefix).toBe(2);
  });
});
