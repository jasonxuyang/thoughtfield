import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { COMMUNITY_CONFIG } from "../config/algorithms";
import type { WordEdge, WordNode } from "./graph-types";
import type { CommunityPartition } from "./community-stabilization";

/**
 * Seeded PRNG (mulberry32) so identical graphs produce stable Louvain runs.
 */
export function createSeededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    const t = (h ^= h >>> 16) >>> 0;
    return (t & 0xfffffff) / 0x10000000;
  };
}

export function detectCommunities(
  nodes: WordNode[],
  edges: WordEdge[],
  resolution: number = COMMUNITY_CONFIG.resolution,
  randomSeed: string = COMMUNITY_CONFIG.randomSeed,
): CommunityPartition[] {
  const graph = new Graph({ type: "undirected", multi: false });

  for (const node of nodes) {
    graph.addNode(node.id);
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.sourceId) || !graph.hasNode(edge.targetId)) {
      continue;
    }
    if (graph.hasEdge(edge.sourceId, edge.targetId)) {
      continue;
    }
    if (edge.combinedWeight <= 0) {
      continue;
    }
    graph.addEdge(edge.sourceId, edge.targetId, {
      weight: edge.combinedWeight,
    });
  }

  if (graph.order === 0) {
    return [];
  }

  const rng = createSeededRandom(randomSeed);
  const assignment = louvain(graph, {
    resolution,
    getEdgeWeight: "weight",
    rng,
  }) as Record<string, number>;

  const buckets = new Map<number, string[]>();
  for (const [nodeId, communityIndex] of Object.entries(assignment)) {
    const list = buckets.get(communityIndex) ?? [];
    list.push(nodeId);
    buckets.set(communityIndex, list);
  }

  return [...buckets.entries()].map(([temporaryId, nodeIds]) => ({
    temporaryId: String(temporaryId),
    nodeIds,
  }));
}
