import { ENTRY_SAMPLE_ID } from "./samples/catalog";
import { loadSampleGraph } from "./samples/load-sample";
import { THOUGHTFIELD_SAMPLE } from "./samples/thoughtfield";
import type { SampleGraph } from "./samples/types";

/** Activation tour pacing for the entry-screen background field. */
export const ENTRY_PREVIEW_CONFIG = {
  /** Delay before the first pulse after hydrate. */
  startDelayMs: 600,
  /** Time between successive node activations. */
  activateIntervalMs: 720,
  /** Pause after the last node before looping. */
  loopPauseMs: 1600,
};

/** @deprecated Prefer SampleGraph from demo/samples. */
export type EntryPreviewGraph = Omit<SampleGraph, "id" | "transcript"> & {
  committedTranscript: "";
};

/** Full sample script for the default entry / Thoughtfield example. */
export function entryPreviewTranscript(): string {
  return THOUGHTFIELD_SAMPLE.transcript;
}

/**
 * Settled entry-field graph (product sample). Prefer precomputed JSON;
 * rebuilds live if the asset is empty/missing.
 */
export async function createEntryPreviewGraph(
  onProgress?: (progress: number) => void,
): Promise<EntryPreviewGraph> {
  const graph = await loadSampleGraph(ENTRY_SAMPLE_ID, onProgress);
  return {
    nodes: graph.nodes,
    edges: graph.edges,
    communities: graph.communities,
    occurrences: graph.occurrences,
    committedTranscript: "",
    sequenceIndex: graph.sequenceIndex,
    activationOrder: graph.activationOrder,
  };
}
