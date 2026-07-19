import { describe, expect, it } from "vitest";
import { updateEmbeddingMean } from "../embeddings/contextual-centroid";
import {
  cosineSimilarity,
  normalizeVector,
} from "../embeddings/vector-math";
import {
  AllPairsSemanticIndex,
  filterSemanticNeighbors,
} from "../embeddings/semantic-index";

describe("vector math and centroids", () => {
  it("updates running mean correctly", () => {
    const first = new Float32Array([2, 4, 6]);
    const second = new Float32Array([4, 6, 8]);
    const mean1 = updateEmbeddingMean(null, 0, first);
    expect([...mean1]).toEqual([2, 4, 6]);
    const mean2 = updateEmbeddingMean(mean1, 1, second);
    expect([...mean2]).toEqual([3, 5, 7]);
  });

  it("normalizes vectors", () => {
    const normalized = normalizeVector(new Float32Array([3, 0, 4]));
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[2]).toBeCloseTo(0.8);
  });

  it("computes cosine similarity for unit vectors", () => {
    const a = normalizeVector(new Float32Array([1, 0]));
    const b = normalizeVector(new Float32Array([1, 0]));
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });

  it("filters semantic neighbors by similarity threshold", () => {
    const filtered = filterSemanticNeighbors(
      [
        { nodeId: "a", similarity: 0.9 },
        { nodeId: "b", similarity: 0.4 },
        { nodeId: "c", similarity: 0.7 },
        { nodeId: "d", similarity: 0.8 },
      ],
      0.48,
    );
    expect(filtered.map((n) => n.nodeId)).toEqual(["a", "c", "d"]);
  });

  it("returns nearest neighbors from all-pairs index", () => {
    const index = new AllPairsSemanticIndex();
    index.updateNode("a", normalizeVector(new Float32Array([1, 0, 0])));
    index.updateNode("b", normalizeVector(new Float32Array([0.9, 0.1, 0])));
    index.updateNode("c", normalizeVector(new Float32Array([0, 1, 0])));
    const neighbors = index.getNearestNeighbors("a");
    expect(neighbors[0]?.nodeId).toBe("b");
    expect(neighbors).toHaveLength(2);
  });
});
