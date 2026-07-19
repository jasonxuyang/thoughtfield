import { ACTIVATION_CONFIG } from "../config/algorithms";
import type { WordEdge, WordNode } from "./graph-types";

type Adj = Map<string, Array<{ nodeId: string; weight: number }>>;

let cachedAdj: Adj | null = null;
let cachedEdgeCount = -1;
let cachedWeightStamp = -1;

function adjacencyFromEdges(edges: WordEdge[]): Adj {
  // Cheap invalidation: size + weight sum changes whenever the graph edits.
  let weightStamp = 0;
  for (const edge of edges) {
    weightStamp += edge.combinedWeight;
  }
  if (
    cachedAdj &&
    cachedEdgeCount === edges.length &&
    Math.abs(cachedWeightStamp - weightStamp) < 1e-6
  ) {
    return cachedAdj;
  }

  const adjacency: Adj = new Map();
  for (const edge of edges) {
    if (edge.combinedWeight <= 0) {
      continue;
    }
    const forward = adjacency.get(edge.sourceId) ?? [];
    forward.push({ nodeId: edge.targetId, weight: edge.combinedWeight });
    adjacency.set(edge.sourceId, forward);

    const backward = adjacency.get(edge.targetId) ?? [];
    backward.push({ nodeId: edge.sourceId, weight: edge.combinedWeight });
    adjacency.set(edge.targetId, backward);
  }

  cachedAdj = adjacency;
  cachedEdgeCount = edges.length;
  cachedWeightStamp = weightStamp;
  return adjacency;
}

export function propagateActivation(
  sourceNodeId: string,
  nodesById: Map<string, WordNode>,
  edges: WordEdge[],
  propagation: number = ACTIVATION_CONFIG.propagation,
  maxDepth: number = ACTIVATION_CONFIG.propagationDepth,
): void {
  const source = nodesById.get(sourceNodeId);
  if (!source) {
    return;
  }

  source.activation = 1;
  source.activationHoldMs = ACTIVATION_CONFIG.peakHoldMs;

  const adjacency = adjacencyFromEdges(edges);

  const visited = new Set<string>([sourceNodeId]);
  let frontier: Array<{ nodeId: string; activation: number }> = [
    { nodeId: sourceNodeId, activation: 1 },
  ];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const nextFrontier: Array<{ nodeId: string; activation: number }> = [];

    for (const current of frontier) {
      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor.nodeId)) {
          continue;
        }

        const neighborNode = nodesById.get(neighbor.nodeId);
        if (!neighborNode) {
          continue;
        }

        const nextActivation =
          current.activation * neighbor.weight * propagation;
        if (nextActivation > neighborNode.activation) {
          neighborNode.activation = nextActivation;
          neighborNode.activationHoldMs = ACTIVATION_CONFIG.peakHoldMs;
        }
        visited.add(neighbor.nodeId);
        nextFrontier.push({
          nodeId: neighbor.nodeId,
          activation: neighborNode.activation,
        });
      }
    }

    frontier = nextFrontier;
  }
}

export function decayActivation(
  nodes: Iterable<WordNode>,
  deltaMs: number,
  halfLifeMs: number = ACTIVATION_CONFIG.decayHalfLifeMs,
  minimumVisible: number = ACTIVATION_CONFIG.minimumVisibleActivation,
): void {
  if (deltaMs <= 0) {
    return;
  }

  for (const node of nodes) {
    let remaining = deltaMs;
    if (node.activationHoldMs > 0) {
      const held = Math.min(remaining, node.activationHoldMs);
      node.activationHoldMs -= held;
      remaining -= held;
    }
    if (remaining <= 0 || node.activation <= 0) {
      continue;
    }

    node.activation *= Math.pow(0.5, remaining / halfLifeMs);
    if (node.activation < minimumVisible) {
      node.activation = 0;
      node.activationHoldMs = 0;
    }
  }
}
