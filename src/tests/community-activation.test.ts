import { describe, expect, it } from "vitest";
import {
  jaccard,
  stabilizeCommunities,
} from "../graph/community-stabilization";
import { detectCommunities } from "../graph/community-detection";
import type { WordEdge, WordNode } from "../graph/graph-types";
import {
  decayActivation,
  propagateActivation,
} from "../graph/activation";

function node(id: string, overrides: Partial<WordNode> = {}): WordNode {
  return {
    id,
    label: id,
    normalizedLabel: id,
    occurrenceCount: 1,
    firstSeenAt: 0,
    lastSeenAt: 0,
    embeddingMean: null,
    normalizedEmbedding: null,
    communityId: null,
    activation: 0,
    activationHoldMs: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    textWidth: 40,
    textHeight: 20,
    graphPlaced: true,
    ...overrides,
  };
}

function edge(
  sourceId: string,
  targetId: string,
  weight: number,
): WordEdge {
  return {
    id: `${sourceId}::${targetId}`,
    sourceId,
    targetId,
    semanticScore: weight,
    colocationRaw: 0,
    colocationScore: 0,
    combinedWeight: weight,
    cooccurrenceCount: 1,
    firstSeenAt: 0,
    lastUpdatedAt: 0,
  };
}

describe("community matching and detection", () => {
  it("computes Jaccard overlap", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(
      1 / 3,
    );
  });

  it("preserves community IDs when overlap exceeds threshold", () => {
    const result = stabilizeCommunities(
      [{ id: "stable-1", nodeIds: ["a", "b", "c"] }],
      [{ temporaryId: "0", nodeIds: ["a", "b", "d"] }],
      0.3,
      () => "new-id",
    );
    expect(result.communities[0]?.id).toBe("stable-1");
    expect(result.communities[0]?.isNew).toBe(false);
  });

  it("creates a new ID when overlap is too low", () => {
    const result = stabilizeCommunities(
      [{ id: "stable-1", nodeIds: ["a", "b"] }],
      [{ temporaryId: "0", nodeIds: ["x", "y", "z"] }],
      0.3,
      () => "fresh",
    );
    expect(result.communities[0]?.id).toBe("fresh");
    expect(result.retiredIds).toContain("stable-1");
  });

  it("runs seeded community detection deterministically", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [
      edge("a", "b", 1),
      edge("b", "c", 1),
      edge("a", "c", 0.9),
      edge("d", "a", 0.05),
    ];

    const first = detectCommunities(nodes, edges, 1, "word-memory");
    const second = detectCommunities(nodes, edges, 1, "word-memory");
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });
});

describe("activation", () => {
  it("propagates activation through strong edges", () => {
    const nodes = new Map([
      ["a", node("a")],
      ["b", node("b")],
      ["c", node("c")],
    ]);
    const edges = [edge("a", "b", 1), edge("b", "c", 1)];
    propagateActivation("a", nodes, edges, 0.65, 2);
    expect(nodes.get("a")!.activation).toBe(1);
    expect(nodes.get("b")!.activation).toBeGreaterThan(0);
    expect(nodes.get("c")!.activation).toBeGreaterThan(0);
    expect(nodes.get("b")!.activation).toBeGreaterThan(
      nodes.get("c")!.activation,
    );
  });

  it("decays activation smoothly", () => {
    const nodes = [node("a", { activation: 1 })];
    decayActivation(nodes, 2500, 2500, 0.02);
    expect(nodes[0]!.activation).toBeCloseTo(0.5);
    decayActivation(nodes, 20_000, 2500, 0.02);
    expect(nodes[0]!.activation).toBe(0);
  });

  it("holds the peak before decay starts", () => {
    const nodes = [node("a", { activation: 1, activationHoldMs: 350 })];
    decayActivation(nodes, 300, 900, 0.02);
    expect(nodes[0]!.activation).toBe(1);
    expect(nodes[0]!.activationHoldMs).toBeCloseTo(50);

    decayActivation(nodes, 50, 900, 0.02);
    expect(nodes[0]!.activation).toBe(1);
    expect(nodes[0]!.activationHoldMs).toBe(0);

    decayActivation(nodes, 900, 900, 0.02);
    expect(nodes[0]!.activation).toBeCloseTo(0.5);
  });
});
