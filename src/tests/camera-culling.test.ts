import { describe, expect, it } from "vitest";
import {
  circleIntersectsBounds,
  clampCameraPan,
  clampCameraToContent,
  minScaleToFitBounds,
  segmentIntersectsBounds,
  worldViewportBounds,
  type WorldBounds,
} from "../rendering/camera";

const BOX: WorldBounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

describe("worldViewportBounds", () => {
  it("maps screen center camera to a symmetric world rect", () => {
    const bounds = worldViewportBounds({ x: 50, y: 50, scale: 1 }, 200, 100, 0);
    expect(bounds).toEqual({
      minX: -50,
      maxX: 150,
      minY: 0,
      maxY: 100,
    });
  });

  it("grows the rect when zoomed out and when margin is applied", () => {
    const tight = worldViewportBounds({ x: 0, y: 0, scale: 1 }, 100, 100, 0);
    const padded = worldViewportBounds({ x: 0, y: 0, scale: 1 }, 100, 100, 20);
    const zoomedOut = worldViewportBounds(
      { x: 0, y: 0, scale: 0.5 },
      100,
      100,
      0,
    );

    expect(padded.minX).toBeLessThan(tight.minX);
    expect(zoomedOut.minX).toBeLessThan(tight.minX);
  });
});

describe("circleIntersectsBounds", () => {
  it("detects overlap for centers inside and grazing the edge", () => {
    expect(circleIntersectsBounds(50, 50, 10, BOX)).toBe(true);
    expect(circleIntersectsBounds(-5, 50, 6, BOX)).toBe(true);
    expect(circleIntersectsBounds(-20, 50, 6, BOX)).toBe(false);
  });
});

describe("segmentIntersectsBounds", () => {
  it("keeps chords that cross the viewport with both ends outside", () => {
    expect(segmentIntersectsBounds(-20, 50, 120, 50, BOX)).toBe(true);
    expect(segmentIntersectsBounds(50, -20, 50, 120, BOX)).toBe(true);
  });

  it("rejects segments that miss the viewport", () => {
    expect(segmentIntersectsBounds(-20, -20, -10, -10, BOX)).toBe(false);
    expect(segmentIntersectsBounds(-20, 110, 120, 110, BOX)).toBe(false);
  });
});

describe("clampCameraToContent", () => {
  const content: WorldBounds = { minX: 0, maxX: 400, minY: 0, maxY: 400 };

  it("keeps the visible rect inside content when view size is known", () => {
    // 200×200 view at scale 1 → half-extents 100; slack is 80.
    const clamped = clampCameraToContent(
      { x: -1000, y: 200, scale: 1 },
      content,
      { width: 200, height: 200 },
    );
    expect(clamped.x).toBe(20); // (0 - 80) + halfW(100)
    expect(clamped.y).toBe(200);
  });

  it("centers when the view is larger than the content", () => {
    const clamped = clampCameraToContent(
      { x: 0, y: 0, scale: 0.25 },
      content,
      { width: 800, height: 800 },
    );
    expect(clamped.x).toBe(200);
    expect(clamped.y).toBe(200);
  });

  it("honors slack=0 for pre-expanded navigable bounds", () => {
    const clamped = clampCameraToContent(
      { x: -1000, y: 200, scale: 1 },
      content,
      { width: 200, height: 200 },
      0,
    );
    expect(clamped.x).toBe(100); // 0 + halfW
    expect(clamped.y).toBe(200);
  });
});

describe("clampCameraPan", () => {
  const content: WorldBounds = { minX: 0, maxX: 400, minY: 0, maxY: 400 };
  const view = { width: 200, height: 200 };

  it("does not teleport when taking over from an outside home pose", () => {
    // Valid x at scale 1 / slack 0 is [100, 300]. Sit left of that like edge focus.
    const previous = { x: 40, y: 200, scale: 1 };
    const proposed = { x: 30, y: 200, scale: 1 }; // further out
    const next = clampCameraPan(previous, proposed, content, view, 0);
    expect(next.x).toBe(40); // blocked outward, no snap to 100
    expect(next.y).toBe(200);
  });

  it("allows panning inward from an outside home pose", () => {
    const previous = { x: 40, y: 200, scale: 1 };
    const proposed = { x: 70, y: 210, scale: 1 };
    const next = clampCameraPan(previous, proposed, content, view, 0);
    expect(next.x).toBe(70);
    expect(next.y).toBe(210);
  });

  it("still clamps once the view is inside the pan AABB", () => {
    const previous = { x: 200, y: 200, scale: 1 };
    const proposed = { x: -1000, y: 200, scale: 1 };
    const next = clampCameraPan(previous, proposed, content, view, 0);
    expect(next.x).toBe(100);
  });
});

describe("minScaleToFitBounds", () => {
  it("returns the scale that fits bounds into the screen", () => {
    const bounds: WorldBounds = { minX: 0, maxX: 400, minY: 0, maxY: 200 };
    expect(minScaleToFitBounds(bounds, 800, 800)).toBe(2);
    expect(minScaleToFitBounds(bounds, 200, 200)).toBe(0.5);
  });
});
