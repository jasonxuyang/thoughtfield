import { describe, expect, it } from "vitest";
import {
  normalizeColocationScore,
  colocationContribution,
} from "../graph/colocation";
import {
  computeCombinedWeight,
  shouldKeepEdge,
} from "../graph/combined-weights";

describe("colocation and combined weights", () => {
  it("decays contribution with token distance", () => {
    expect(colocationContribution(1, 4)).toBeCloseTo(1);
    expect(colocationContribution(5, 4)).toBeCloseTo(Math.exp(-1));
    expect(colocationContribution(20, 4)).toBeLessThan(0.01);
    expect(colocationContribution(0, 4)).toBe(0);
  });

  it("saturates colocation raw into 0..1", () => {
    expect(normalizeColocationScore(0)).toBeCloseTo(0);
    expect(normalizeColocationScore(3)).toBeCloseTo(1 - Math.exp(-1));
    expect(normalizeColocationScore(100)).toBeGreaterThan(0.99);
  });

  it("combines semantic and colocation scores", () => {
    expect(computeCombinedWeight(1, 0, 0.5, 0.5)).toBeCloseTo(0.5);
    expect(computeCombinedWeight(0, 1, 0.5, 0.5)).toBeCloseTo(0.5);
    expect(computeCombinedWeight(1, 1, 0.5, 0.5)).toBeCloseTo(1);
  });

  it("keeps edges by threshold rules", () => {
    expect(
      shouldKeepEdge({
        semanticScore: 0.1,
        colocationScore: 0.09,
        combinedWeight: 0.1,
      }),
    ).toBe(true);

    expect(
      shouldKeepEdge({
        semanticScore: 0.5,
        colocationScore: 0,
        combinedWeight: 0.1,
      }),
    ).toBe(true);

    expect(
      shouldKeepEdge({
        semanticScore: 0.1,
        colocationScore: 0.01,
        combinedWeight: 0.05,
      }),
    ).toBe(false);
  });
});
