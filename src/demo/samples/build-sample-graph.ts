import { normalizeVector } from "../../embeddings/vector-math";
import { GraphStore } from "../../graph/graph-store";
import { transcriptToCommittedWords } from "../seed-transcript";
import type { SampleDefinition, SampleGraph } from "./types";

const EMBED_DIM = 32;
const SETTLE_MIN_TICKS = 64;
const SETTLE_MAX_TICKS = 220;
const SETTLE_DT_MS = 16;
const SETTLE_ENERGY_EPS = 2.5;

function groupVector(groupIndex: number, label: string): Float32Array {
  const vector = new Float32Array(EMBED_DIM);
  vector[groupIndex % EMBED_DIM] = 1;
  vector[(groupIndex + 4) % EMBED_DIM] = 0.45;
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

function embeddingForLabel(
  label: string,
  semanticGroups: string[][],
): Float32Array {
  const hits: number[] = [];
  for (let g = 0; g < semanticGroups.length; g += 1) {
    if (semanticGroups[g]!.includes(label)) {
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

function injectSemanticEmbeddings(
  store: GraphStore,
  semanticGroups: string[][],
): void {
  const cache = new Map<string, Float32Array>();
  for (const occurrence of store.occurrences) {
    let embedding = cache.get(occurrence.normalizedText);
    if (!embedding) {
      embedding = embeddingForLabel(occurrence.normalizedText, semanticGroups);
      cache.set(occurrence.normalizedText, embedding);
    }
    store.applyEmbedding(occurrence.id, embedding);
  }
}

/** Deterministic PRNG so precomputed activation tours stay stable. */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function softShuffle(
  ids: string[],
  radius: number,
  random: () => number,
): string[] {
  const order = [...ids];
  for (let i = 0; i < order.length; i += 1) {
    const span = radius * 2 + 1;
    const j = Math.min(
      order.length - 1,
      Math.max(0, i + Math.floor(random() * span) - radius),
    );
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
}

function activationTourOrder(store: GraphStore, sampleId: string): string[] {
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
  return softShuffle(order, 7, mulberry32(seedFromId(sampleId)));
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
 * Grow a sample field through the real GraphStore path:
 * normalize → ingest → colocation → synthetic embeddings → Louvain → settle.
 */
export async function buildSampleGraph(
  definition: SampleDefinition,
  onProgress?: (progress: number) => void,
): Promise<SampleGraph> {
  const report = (progress: number): void => {
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };

  const store = new GraphStore();
  report(0.04);

  const words = transcriptToCommittedWords(definition.transcript);
  if (words.length > 0) {
    store.ingestCommittedWords(words);
  }
  report(0.18);
  await yieldToMain();

  injectSemanticEmbeddings(store, definition.semanticGroups);
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
  const activationOrder = activationTourOrder(store, definition.id);
  report(1);

  return {
    id: definition.id,
    transcript: definition.transcript,
    nodes: persisted.nodes,
    edges: persisted.edges,
    communities: persisted.communities,
    occurrences: persisted.occurrences,
    sequenceIndex: persisted.sequenceIndex,
    activationOrder,
  };
}
