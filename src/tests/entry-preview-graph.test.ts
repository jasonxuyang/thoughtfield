import { describe, expect, it } from "vitest";
import { createEntryPreviewGraph } from "../demo/entry-preview-graph";

describe("entry preview graph", () => {
  it("builds a real GraphStore field from the project script", async () => {
    const graph = await createEntryPreviewGraph();

    expect(graph.nodes.length).toBeGreaterThan(15);
    expect(graph.edges.length).toBeGreaterThan(10);
    expect(graph.communities.length).toBeGreaterThanOrEqual(2);
    expect(graph.activationOrder.length).toBe(graph.nodes.length);
    expect(graph.committedTranscript).toBe("");
    expect(graph.occurrences).toEqual([]);

    expect(graph.nodes.every((node) => node.normalizedEmbedding)).toBe(true);
    expect(graph.nodes.every((node) => node.graphPlaced)).toBe(true);
    expect(graph.edges.some((edge) => edge.semanticScore > 0.4)).toBe(true);
    expect(graph.edges.some((edge) => edge.colocationScore > 0)).toBe(true);
  });
});
