import type {
  Community,
  WordEdge,
  WordNode,
  WordOccurrence,
} from "../../graph/graph-types";

/** Spec used to build (or rebuild) a canned sample field. */
export type SampleDefinition = {
  id: string;
  /** Button / menu label. */
  label: string;
  /** Tooltip on the entry action. */
  tooltip: string;
  transcript: string;
  /** Theme neighborhoods — labels match normalizeTranscriptWords lemmas. */
  semanticGroups: string[][];
};

/** Runtime graph payload ready to hydrate into the worker. */
export type SampleGraph = {
  id: string;
  transcript: string;
  nodes: WordNode[];
  edges: WordEdge[];
  communities: Community[];
  /**
   * Fully embedded speech-order occurrences. Entry preview omits these on
   * hydrate; adopting a sample includes them so transcript reveal can advance.
   */
  occurrences: WordOccurrence[];
  sequenceIndex: number;
  /** Soft-shuffled first-seen order for the entry activation loop. */
  activationOrder: string[];
};

/** JSON-safe form written by `npm run precompute:samples`. */
export type SerializedSampleGraph = {
  id: string;
  transcript: string;
  sequenceIndex: number;
  activationOrder: string[];
  nodes: unknown[];
  edges: unknown[];
  communities: unknown[];
  occurrences: unknown[];
};
