import type { RenderEdge, RenderNode } from "./graph-types";

type TourNeighbor = {
  id: string;
  weight: number;
};

/**
 * Walk order for the ambient idle tour: start at the strongest hub, then
 * prefer heavy unused neighbors so the path feels like graph traversal
 * rather than a random slideshow.
 */
export function buildIdleTourOrder(
  nodes: readonly RenderNode[],
  edges: readonly RenderEdge[],
): string[] {
  const ready = nodes.filter((node) => node.embeddingReady);
  if (ready.length === 0) {
    return [];
  }

  const adj = new Map<string, TourNeighbor[]>();
  const ensure = (id: string): TourNeighbor[] => {
    const existing = adj.get(id);
    if (existing) {
      return existing;
    }
    const created: TourNeighbor[] = [];
    adj.set(id, created);
    return created;
  };

  const readyIds = new Set(ready.map((node) => node.id));
  for (const edge of edges) {
    if (!readyIds.has(edge.sourceId) || !readyIds.has(edge.targetId)) {
      continue;
    }
    ensure(edge.sourceId).push({
      id: edge.targetId,
      weight: edge.combinedWeight,
    });
    ensure(edge.targetId).push({
      id: edge.sourceId,
      weight: edge.combinedWeight,
    });
  }

  for (const neighbors of adj.values()) {
    neighbors.sort((a, b) => b.weight - a.weight);
  }

  const byHub = [...ready].sort((a, b) => {
    const degreeDelta = b.degree - a.degree;
    if (degreeDelta !== 0) {
      return degreeDelta;
    }
    return b.edgeWeightSum - a.edgeWeightSum;
  });

  const order: string[] = [];
  const visited = new Set<string>();

  const walkFrom = (startId: string): void => {
    let current: string | null = startId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      order.push(current);
      const neighbors: TourNeighbor[] = adj.get(current) ?? [];
      let nextId: string | null = null;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.id)) {
          nextId = neighbor.id;
          break;
        }
      }
      current = nextId;
    }
  };

  for (const hub of byHub) {
    if (!visited.has(hub.id)) {
      walkFrom(hub.id);
    }
  }

  return order;
}
