import {
  EDGE_CONFIG,
  SEMANTIC_CONFIG,
} from "../config/algorithms";
import type { WordEdge } from "./graph-types";
import { normalizeColocationScore } from "./colocation";

export function computeCombinedWeight(
  semanticScore: number,
  colocationScore: number,
  semanticWeight: number = EDGE_CONFIG.semanticWeight,
  colocationWeight: number = EDGE_CONFIG.colocationWeight,
): number {
  return semanticWeight * semanticScore + colocationWeight * colocationScore;
}

export function shouldKeepEdge(
  edge: Pick<WordEdge, "semanticScore" | "colocationScore" | "combinedWeight">,
  options: {
    minimumSimilarity?: number;
    minimumCombinedWeight?: number;
    minimumColocationKeep?: number;
  } = {},
): boolean {
  const minimumSimilarity =
    options.minimumSimilarity ?? SEMANTIC_CONFIG.minimumSimilarity;
  const minimumCombinedWeight =
    options.minimumCombinedWeight ?? EDGE_CONFIG.minimumCombinedWeight;
  const minimumColocationKeep =
    options.minimumColocationKeep ?? EDGE_CONFIG.minimumColocationKeep;

  return (
    edge.colocationScore > minimumColocationKeep ||
    edge.semanticScore >= minimumSimilarity ||
    edge.combinedWeight >= minimumCombinedWeight
  );
}

export function refreshEdgeScores(
  edge: WordEdge,
  semanticWeight: number = EDGE_CONFIG.semanticWeight,
  colocationWeight: number = EDGE_CONFIG.colocationWeight,
): WordEdge {
  const colocationScore = normalizeColocationScore(edge.colocationRaw);
  const combinedWeight = computeCombinedWeight(
    edge.semanticScore,
    colocationScore,
    semanticWeight,
    colocationWeight,
  );

  return {
    ...edge,
    colocationScore,
    combinedWeight,
  };
}

export function makeEdgeId(sourceId: string, targetId: string): string {
  return sourceId < targetId
    ? `${sourceId}::${targetId}`
    : `${targetId}::${sourceId}`;
}
