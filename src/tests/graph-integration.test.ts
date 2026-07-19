import { describe, expect, it } from "vitest";
import { GraphStore } from "../graph/graph-store";
import type { CommittedWord } from "../graph/graph-types";

function wordsFromText(
  text: string,
  startMs: number,
): CommittedWord[] {
  return text.split(/\s+/).map((token, index) => ({
    rawText: token,
    normalizedText: token.toLowerCase(),
    startTimeMs: startMs + index * 200,
    endTimeMs: startMs + index * 200 + 150,
    sequenceIndex: index,
  }));
}

function injectSemanticEmbeddings(
  store: GraphStore,
  groups: string[][],
): void {
  const vectors = new Map<string, Float32Array>();

  groups.forEach((group, groupIndex) => {
    for (const label of group) {
      const vector = new Float32Array(8);
      vector[groupIndex] = 1;
      vector[groupIndex + 3] = 0.2;
      vectors.set(label, vector);
    }
  });

  for (const occurrence of store.occurrences) {
    const embedding = vectors.get(occurrence.normalizedText);
    if (embedding) {
      store.applyEmbedding(occurrence.id, embedding);
    }
  }
}

describe("graph integration", () => {
  it("forms semantic relationships within a related triad", () => {
    const store = new GraphStore();
    store.applySettings({
      minimumSimilarity: 0.4,
      semanticWeight: 0.8,
      colocationWeight: 0.2,
    });

    store.ingestCommittedWords(wordsFromText("car automobile vehicle", 0));
    injectSemanticEmbeddings(store, [["car", "automobile", "vehicle"]]);
    store.recluster();

    const edges = [...store.edges.values()];
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((edge) => edge.semanticScore >= 0.4)).toBe(true);

    const communityIds = new Set(
      [...store.nodes.values()].map((node) => node.communityId),
    );
    expect(communityIds.size).toBe(1);
  });

  it("strengthens colocation relationships through repetition", () => {
    const store = new GraphStore();
    store.applySettings({
      semanticWeight: 0.2,
      colocationWeight: 0.8,
      minimumSimilarity: 0.95,
    });

    for (let i = 0; i < 5; i += 1) {
      store.ingestCommittedWords(
        wordsFromText("webgpu transcription browser", i * 1000),
      );
    }

    const labelOf = (id: string) => store.nodes.get(id)?.normalizedLabel;
    const edge = [...store.edges.values()].find((item) => {
      const labels = new Set([
        labelOf(item.sourceId),
        labelOf(item.targetId),
      ]);
      return (
        labels.has("webgpu") &&
        (labels.has("transcription") || labels.has("browser"))
      );
    });

    expect(edge).toBeTruthy();
    expect(edge!.colocationScore).toBeGreaterThan(0.5);
    expect(edge!.cooccurrenceCount).toBeGreaterThan(1);
  });

  it("separates unrelated topic communities spatially", () => {
    const store = new GraphStore();
    store.applySettings({
      semanticWeight: 0.7,
      colocationWeight: 0.3,
      minimumSimilarity: 0.45,
    });

    store.ingestCommittedWords(
      wordsFromText("webgpu browser transcription", 0),
    );
    store.ingestCommittedWords(
      wordsFromText("recipe mushroom ginger", 60_000),
    );
    store.ingestCommittedWords(
      wordsFromText("insurance deductible collision", 120_000),
    );

    injectSemanticEmbeddings(store, [
      ["webgpu", "browser", "transcription"],
      ["recipe", "mushroom", "ginger"],
      ["insurance", "deductible", "collision"],
    ]);

    store.recluster();
    expect(store.communities.size).toBeGreaterThanOrEqual(2);

    // Settle layout a bit
    for (let i = 0; i < 40; i += 1) {
      store.tick(16);
    }

    const communities = [...store.communities.values()];
    if (communities.length >= 2) {
      const distances: number[] = [];
      for (let i = 0; i < communities.length; i += 1) {
        for (let j = i + 1; j < communities.length; j += 1) {
          const a = communities[i]!;
          const b = communities[j]!;
          distances.push(
            Math.hypot(a.anchorX - b.anchorX, a.anchorY - b.anchorY),
          );
        }
      }
      expect(Math.max(...distances)).toBeGreaterThan(100);
    }
  });

  it("activates a spoken word and fades over time", () => {
    const store = new GraphStore();
    store.ingestCommittedWords(wordsFromText("alpha beta gamma", 0));
    const alpha = [...store.nodes.values()].find(
      (node) => node.normalizedLabel === "alpha",
    );
    expect(alpha).toBeTruthy();
    expect(alpha!.activation).toBe(1);

    store.tick(2500);
    expect(alpha!.activation).toBeLessThan(1);
    expect(alpha!.activation).toBeGreaterThan(0);

    store.tick(20_000);
    expect(alpha!.activation).toBe(0);
  });

  it("holds activation while a node is pinned for inspection", () => {
    const store = new GraphStore();
    store.ingestCommittedWords(wordsFromText("alpha beta gamma", 0));
    const alpha = [...store.nodes.values()].find(
      (node) => node.normalizedLabel === "alpha",
    );
    expect(alpha).toBeTruthy();

    store.tick(20_000);
    expect(alpha!.activation).toBe(0);

    store.setPinnedNode(alpha!.id);
    expect(alpha!.activation).toBe(1);

    store.tick(20_000);
    expect(alpha!.activation).toBe(1);

    store.setPinnedNode(null);
    store.tick(20_000);
    expect(alpha!.activation).toBe(0);
  });
});
