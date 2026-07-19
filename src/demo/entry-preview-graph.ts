import { normalizeVector } from "../embeddings/vector-math";
import { GraphStore } from "../graph/graph-store";
import type {
  Community,
  WordEdge,
  WordNode,
} from "../graph/graph-types";
import { transcriptToCommittedWords } from "./seed-transcript";

/** Activation tour pacing for the entry-screen background field. */
export const ENTRY_PREVIEW_CONFIG = {
  /** Delay before the first pulse after hydrate. */
  startDelayMs: 600,
  /** Time between successive node activations. */
  activateIntervalMs: 720,
  /** Pause after the last node before looping. */
  loopPauseMs: 1600,
};

/**
 * Spoken-style passages about the product. Ingested in order so nearby words
 * form colocation links; semantic groups below shape clusters.
 */
const PREVIEW_PASSAGES = [
  "Thoughtfield listens in the browser. Microphone speech becomes a Whisper transcript on your local device.",
  "Paste a transcript or keep speaking. Words arrive as language unfolds in real time.",
  "Local embeddings place each word in context. Semantic similarity pulls related language toward shared meaning.",
  "Embeddings bind ideas across the session while context keeps nearby phrases aligned.",
  "The graph grows from semantic links and colocation. Related ideas cluster into communities.",
  "Nodes settle into a kinetic field. Communities tighten as similarity and phrases reinforce each other.",
  "Activation spreads through connected nodes when you speak or paste. The field pulses with meaning.",
  "Thoughtfield stays private on your device. Browser speech, Whisper, embeddings, and the graph never leave.",
];

/** Full sample script (passages + short encore) for preview build and Try a sample. */
export function entryPreviewTranscript(): string {
  return [...PREVIEW_PASSAGES, ...PREVIEW_PASSAGES.slice(0, 4)].join(" ");
}

/** Theme neighborhoods — labels match normalizeTranscriptWords lemmas. */
const SEMANTIC_GROUPS: string[][] = [
  [
    "thoughtfield",
    "listen",
    "browser",
    "microphone",
    "speech",
    "whisper",
    "transcript",
    "device",
    "local",
    "private",
    "paste",
    "speak",
  ],
  [
    "embedding",
    "context",
    "semantic",
    "similarity",
    "language",
    "mean",
    "word",
    "idea",
    "session",
    "align",
  ],
  [
    "graph",
    "colocation",
    "community",
    "node",
    "phrase",
    "cluster",
    "link",
    "co-occurrence",
    "field",
    "grow",
  ],
  [
    "activation",
    "kinetic",
    "pulse",
    "spread",
    "connect",
    "reinforce",
    "settle",
    "tighten",
    "relate",
  ],
];

const EMBED_DIM = 32;
/** Floor ticks before early-exit on energy is allowed. */
const SETTLE_MIN_TICKS = 64;
/** Hard cap — enough for communities to stop drifting. */
const SETTLE_MAX_TICKS = 220;
const SETTLE_DT_MS = 16;
/** Sum of vx²+vy² — below this the field reads as settled. */
const SETTLE_ENERGY_EPS = 2.5;

export type EntryPreviewGraph = {
  nodes: WordNode[];
  edges: WordEdge[];
  communities: Community[];
  occurrences: [];
  committedTranscript: "";
  sequenceIndex: number;
  /** Soft-shuffled first-seen order for the activation loop. */
  activationOrder: string[];
};

function groupVector(groupIndex: number, label: string): Float32Array {
  const vector = new Float32Array(EMBED_DIM);
  vector[groupIndex % EMBED_DIM] = 1;
  vector[(groupIndex + 4) % EMBED_DIM] = 0.45;
  // Tiny per-label jitter so neighbors aren't identical.
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
  }
  vector[8 + (hash % 12)] = 0.18 + (hash % 7) * 0.02;
  return normalizeVector(vector);
}

function hashVector(label: string): Float32Array {
  const vector = new Float32Array(EMBED_DIM);
  let hash = 2166136261;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  for (let i = 0; i < 4; i += 1) {
    const idx = (hash + i * 7) % EMBED_DIM;
    vector[idx] = 0.35 - i * 0.05;
    hash = Math.imul(hash, 16777619);
  }
  return normalizeVector(vector);
}

function embeddingForLabel(label: string): Float32Array {
  const hits: number[] = [];
  for (let g = 0; g < SEMANTIC_GROUPS.length; g += 1) {
    if (SEMANTIC_GROUPS[g]!.includes(label)) {
      hits.push(g);
    }
  }
  if (hits.length === 0) {
    return hashVector(label);
  }
  if (hits.length === 1) {
    return groupVector(hits[0]!, label);
  }
  const mixed = new Float32Array(EMBED_DIM);
  for (const groupIndex of hits) {
    const part = groupVector(groupIndex, label);
    for (let i = 0; i < EMBED_DIM; i += 1) {
      mixed[i]! += part[i]!;
    }
  }
  return normalizeVector(mixed);
}

function injectSemanticEmbeddings(store: GraphStore): void {
  const cache = new Map<string, Float32Array>();
  for (const occurrence of store.occurrences) {
    let embedding = cache.get(occurrence.normalizedText);
    if (!embedding) {
      embedding = embeddingForLabel(occurrence.normalizedText);
      cache.set(occurrence.normalizedText, embedding);
    }
    store.applyEmbedding(occurrence.id, embedding);
  }
}

function activationTourOrder(store: GraphStore): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const occurrence of store.occurrences) {
    if (seen.has(occurrence.wordId)) {
      continue;
    }
    if (!store.nodes.has(occurrence.wordId)) {
      continue;
    }
    seen.add(occurrence.wordId);
    order.push(occurrence.wordId);
  }
  return softShuffle(order, 7);
}

/** Local swaps so the tour wanders without becoming pure noise. */
function softShuffle(ids: string[], radius: number): string[] {
  const order = [...ids];
  for (let i = 0; i < order.length; i += 1) {
    const span = radius * 2 + 1;
    const j = Math.min(
      order.length - 1,
      Math.max(0, i + Math.floor(Math.random() * span) - radius),
    );
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

function layoutEnergy(store: GraphStore): number {
  let energy = 0;
  for (const node of store.nodes.values()) {
    energy += node.vx * node.vx + node.vy * node.vy;
  }
  return energy;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Grow a preview field through the real GraphStore path:
 * normalize → ingest → colocation edges → synthetic contextual embeddings →
 * semantic neighbors → Louvain communities → layout settle.
 * Yields while settling so the boot screen can report progress.
 */
export async function createEntryPreviewGraph(
  onProgress?: (progress: number) => void,
): Promise<EntryPreviewGraph> {
  const report = (progress: number): void => {
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };

  const store = new GraphStore();
  report(0.04);

  const script = entryPreviewTranscript();
  const words = transcriptToCommittedWords(script);
  if (words.length > 0) {
    store.ingestCommittedWords(words);
  }
  report(0.18);
  await yieldToMain();

  injectSemanticEmbeddings(store);
  report(0.28);
  await yieldToMain();

  store.recluster();
  report(0.36);
  await yieldToMain();

  for (let i = 0; i < SETTLE_MAX_TICKS; i += 1) {
    store.tick(SETTLE_DT_MS);
    if (i % 8 === 0) {
      report(0.36 + 0.54 * (i / SETTLE_MAX_TICKS));
      await yieldToMain();
    }
    if (i + 1 >= SETTLE_MIN_TICKS && layoutEnergy(store) < SETTLE_ENERGY_EPS) {
      break;
    }
  }
  report(0.94);

  for (const node of store.nodes.values()) {
    node.activation = 0;
    node.activationHoldMs = 0;
    node.vx = 0;
    node.vy = 0;
  }
  store.focusNodeId = null;
  store.pinnedNodeId = null;

  const persisted = store.serializeForPersistence();
  const activationOrder = activationTourOrder(store);
  report(1);

  return {
    nodes: persisted.nodes,
    edges: persisted.edges,
    communities: persisted.communities,
    // Omit occurrences so the live worker won't queue embed work.
    occurrences: [],
    committedTranscript: "",
    sequenceIndex: persisted.sequenceIndex,
    activationOrder,
  };
}
