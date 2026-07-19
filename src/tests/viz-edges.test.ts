import { describe, expect, it } from "vitest";
import { VIZ_EDGE_CONFIG } from "../config/algorithms";
import { selectRenderEdgesForViz } from "../graph/viz-edges";

describe("selectRenderEdgesForViz", () => {
  it("keeps a dense cluster of equally strong edges past the soft max", () => {
    const strongCount = VIZ_EDGE_CONFIG.softMaxRenderEdges + 40;
    const candidates = Array.from({ length: strongCount }, (_, i) => ({
      id: `strong-${i}`,
      combinedWeight: 0.9 - i * 0.0001,
      hot: false,
    }));

    const selected = selectRenderEdgesForViz(candidates);
    expect(selected.length).toBe(strongCount);
    expect(selected.length).toBeGreaterThan(VIZ_EDGE_CONFIG.softMaxRenderEdges);
  });

  it("trims weak cold edges once the soft budget is full", () => {
    const softMax = VIZ_EDGE_CONFIG.softMaxRenderEdges;
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `top-${i}`,
        combinedWeight: 0.9,
        hot: false,
      })),
      ...Array.from({ length: softMax + 50 }, (_, i) => ({
        id: `weak-${i}`,
        combinedWeight: VIZ_EDGE_CONFIG.minWeight + 0.01,
        hot: false,
      })),
    ];

    const selected = selectRenderEdgesForViz(candidates);
    expect(selected.length).toBe(softMax);
    expect(selected.every((edge) => edge.id.startsWith("top-") || edge.id.startsWith("weak-"))).toBe(
      true,
    );
    expect(selected.filter((edge) => edge.id.startsWith("top-")).length).toBe(10);
    expect(selected.filter((edge) => edge.id.startsWith("weak-")).length).toBe(
      softMax - 10,
    );
  });

  it("always keeps hot edges even when they are below alwaysRenderWeight", () => {
    const softMax = VIZ_EDGE_CONFIG.softMaxRenderEdges;
    const candidates = [
      ...Array.from({ length: softMax }, (_, i) => ({
        id: `cold-${i}`,
        combinedWeight: 0.9,
        hot: false,
      })),
      {
        id: "hot-weak",
        combinedWeight: VIZ_EDGE_CONFIG.activeMinWeight + 0.01,
        hot: true,
      },
    ];

    const selected = selectRenderEdgesForViz(candidates);
    expect(selected.some((edge) => edge.id === "hot-weak")).toBe(true);
    expect(selected.length).toBe(softMax + 1);
  });
});
