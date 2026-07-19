import { describe, expect, it } from "vitest";
import { createEntryPreviewGraph } from "../demo/entry-preview-graph";
import { SAMPLE_CATALOG } from "../demo/samples/catalog";
import { loadSampleGraph } from "../demo/samples/load-sample";
import { GraphStore } from "../graph/graph-store";
import { normalizeTranscriptWords } from "../transcription/normalization";

describe("entry preview graph", () => {
  it("loads the precomputed Thoughtfield entry field", async () => {
    const graph = await createEntryPreviewGraph();

    expect(graph.nodes.length).toBeGreaterThan(15);
    expect(graph.edges.length).toBeGreaterThan(10);
    expect(graph.communities.length).toBeGreaterThanOrEqual(2);
    expect(graph.activationOrder.length).toBe(graph.nodes.length);
    expect(graph.committedTranscript).toBe("");
    expect(graph.occurrences.length).toBeGreaterThan(15);
    expect(
      graph.occurrences.every((occurrence) => occurrence.embeddingProcessed),
    ).toBe(true);

    expect(graph.nodes.every((node) => node.normalizedEmbedding)).toBe(true);
    expect(graph.nodes.every((node) => node.graphPlaced)).toBe(true);
    expect(graph.edges.some((edge) => edge.semanticScore > 0.4)).toBe(true);
    expect(graph.edges.some((edge) => edge.colocationScore > 0)).toBe(true);
  });

  it("hydrates a full embeddedOccurrencePrefix for sample transcript reveal", async () => {
    const graph = await loadSampleGraph("thoughtfield");
    const store = new GraphStore();
    store.hydrate({
      nodes: graph.nodes,
      edges: graph.edges,
      communities: graph.communities,
      occurrences: graph.occurrences,
      committedTranscript: graph.transcript,
      sequenceIndex: graph.sequenceIndex,
    });

    expect(store.toSnapshot().embeddedOccurrencePrefix).toBe(
      graph.occurrences.length,
    );
  });
});

describe("precomputed samples", () => {
  it("ships every catalog sample with matching occurrence counts", async () => {
    for (const definition of SAMPLE_CATALOG) {
      const graph = await loadSampleGraph(definition.id);
      expect(graph.id).toBe(definition.id);
      expect(graph.transcript).toBe(definition.transcript);
      expect(graph.nodes.length).toBeGreaterThan(10);
      expect(graph.occurrences.length).toBe(
        normalizeTranscriptWords(definition.transcript).length,
      );
      expect(
        graph.occurrences.every((occurrence) => occurrence.embeddingProcessed),
      ).toBe(true);
    }
  });

  it("includes Hangul surface tokens in the Golden sample", async () => {
    const graph = await loadSampleGraph("golden");
    const labels = new Set(graph.nodes.map((node) => node.label));
    expect(labels.has("영원히")).toBe(true);
    expect(labels.has("빛나는")).toBe(true);
    expect(labels.has("golden")).toBe(true);
    expect(labels.has("shine")).toBe(true);
    expect(labels.has("born")).toBe(true);
  });

  it("includes battle and unity tokens in the Gettysburg sample", async () => {
    const graph = await loadSampleGraph("gettysburg");
    const labels = new Set(graph.nodes.map((node) => node.label));
    expect(labels.has("gettysburg")).toBe(true);
    expect(labels.has("fight")).toBe(true);
    expect(labels.has("brother")).toBe(true);
    expect(labels.has("respect")).toBe(true);
    expect(labels.has("together")).toBe(true);
  });
});
