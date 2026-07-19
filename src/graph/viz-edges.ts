import { VIZ_EDGE_CONFIG } from "../config/algorithms";

type VizEdgeCandidate = {
  combinedWeight: number;
  /** Endpoint activation clears the hot threshold. */
  hot: boolean;
};

/**
 * Soft-budget viz edge selection.
 *
 * - Always keeps edges near the top of the weight distribution (and hot ones),
 *   so a cluster of equally strong links is not arbitrarily truncated.
 * - Fills remaining soft-budget slots with the next-strongest cold edges.
 * - Applies a high safety ceiling only for pathological denseness.
 */
export function selectRenderEdgesForViz<T extends VizEdgeCandidate>(
  candidates: T[],
): T[] {
  const eligible: T[] = [];
  for (const edge of candidates) {
    const minWeight = edge.hot
      ? VIZ_EDGE_CONFIG.activeMinWeight
      : VIZ_EDGE_CONFIG.minWeight;
    if (edge.combinedWeight >= minWeight) {
      eligible.push(edge);
    }
  }

  if (eligible.length === 0) {
    return [];
  }

  eligible.sort((a, b) => b.combinedWeight - a.combinedWeight);
  const topWeight = eligible[0]!.combinedWeight;
  const parityFloor = topWeight * VIZ_EDGE_CONFIG.strongParity;
  const alwaysFloor = Math.max(
    VIZ_EDGE_CONFIG.alwaysRenderWeight,
    parityFloor,
  );

  const mustKeep: T[] = [];
  const optional: T[] = [];
  for (const edge of eligible) {
    if (edge.hot || edge.combinedWeight >= alwaysFloor) {
      mustKeep.push(edge);
    } else {
      optional.push(edge);
    }
  }

  const softMax = VIZ_EDGE_CONFIG.softMaxRenderEdges;
  const fillSlots = Math.max(0, softMax - mustKeep.length);
  const selected = mustKeep.concat(optional.slice(0, fillSlots));

  if (selected.length <= VIZ_EDGE_CONFIG.hardSafetyMaxRenderEdges) {
    return selected;
  }
  return selected.slice(0, VIZ_EDGE_CONFIG.hardSafetyMaxRenderEdges);
}
