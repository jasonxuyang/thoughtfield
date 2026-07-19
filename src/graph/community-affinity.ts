import { LAYOUT_CONFIG } from "../config/algorithms";
import { semanticSimilarity } from "../embeddings/vector-math";
import type { Community, WordEdge, WordNode } from "./graph-types";
import { normalizeVector } from "../embeddings/vector-math";

export function computeCommunityCentroid(
  community: Community,
  nodesById: Map<string, WordNode>,
): Float32Array | null {
  let dimension = 0;
  const weighted: number[] = [];
  let totalWeight = 0;

  for (const nodeId of community.nodeIds) {
    const node = nodesById.get(nodeId);
    if (!node?.normalizedEmbedding) {
      continue;
    }

    const weight = 1 + Math.log1p(node.occurrenceCount);
    if (dimension === 0) {
      dimension = node.normalizedEmbedding.length;
      for (let i = 0; i < dimension; i += 1) {
        weighted[i] = 0;
      }
    }

    for (let i = 0; i < dimension; i += 1) {
      weighted[i]! += node.normalizedEmbedding[i]! * weight;
    }
    totalWeight += weight;
  }

  if (dimension === 0 || totalWeight === 0) {
    return null;
  }

  const mean = new Float32Array(dimension);
  for (let i = 0; i < dimension; i += 1) {
    mean[i] = weighted[i]! / totalWeight;
  }

  return normalizeVector(mean);
}

export function communityColocationAffinity(
  a: Community,
  b: Community,
  edges: WordEdge[],
): number {
  const aSet = new Set(a.nodeIds);
  const bSet = new Set(b.nodeIds);
  let sum = 0;
  let count = 0;

  for (const edge of edges) {
    const crosses =
      (aSet.has(edge.sourceId) && bSet.has(edge.targetId)) ||
      (aSet.has(edge.targetId) && bSet.has(edge.sourceId));
    if (!crosses) {
      continue;
    }
    sum += edge.colocationScore;
    count += 1;
  }

  if (count === 0) {
    return 0;
  }

  return Math.min(1, sum / count);
}

export function communityAffinity(
  a: Community,
  b: Community,
  edges: WordEdge[],
  semanticWeight: number = LAYOUT_CONFIG.communityAffinitySemantic,
  colocationWeight: number = LAYOUT_CONFIG.communityAffinityColocation,
): number {
  const semantic =
    a.centroidEmbedding && b.centroidEmbedding
      ? semanticSimilarity(a.centroidEmbedding, b.centroidEmbedding)
      : 0;
  const colocation = communityColocationAffinity(a, b, edges);
  return semanticWeight * semantic + colocationWeight * colocation;
}

export function desiredCommunityDistance(affinity: number): number {
  return (
    LAYOUT_CONFIG.minCommunityDistance +
    (1 - affinity) * LAYOUT_CONFIG.communityDistanceRange
  );
}

export function communityRadius(nodeCount: number): number {
  return (
    LAYOUT_CONFIG.communityBaseRadius +
    Math.sqrt(Math.max(1, nodeCount)) * LAYOUT_CONFIG.communityRadiusScale
  );
}
