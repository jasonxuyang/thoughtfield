import { Container, Graphics, Rectangle } from "pixi.js";
import type { RenderNode } from "../graph/graph-types";
import type { CameraState, WorldBounds } from "./camera";

export const MINIMAP_CONFIG = {
  width: 156,
  height: 114,
  /** Offset from the top-right screen corner. */
  margin: 24,
  /** Hairline clearance inside the frame — keep tiny so the map stays true. */
  inset: 2,
};

type MapTransform = {
  originX: number;
  originY: number;
  scale: number;
  bounds: WorldBounds;
  /** Fitted world content rect in map pixels (inside the frame inset). */
  contentWidth: number;
  contentHeight: number;
};

type PlotNode = {
  id: string;
  x: number;
  y: number;
  activation: number;
  fontSize: number;
};

export class Minimap {
  readonly container = new Container();
  private frame = new Graphics();
  private dots = new Graphics();
  private viewport = new Graphics();
  private transform: MapTransform | null = null;
  private layout = {
    x: 0,
    y: 0,
    width: MINIMAP_CONFIG.width,
    height: MINIMAP_CONFIG.height,
  };

  constructor() {
    this.container.addChild(this.frame);
    this.container.addChild(this.dots);
    this.container.addChild(this.viewport);
    this.container.eventMode = "static";
    this.container.cursor = "pointer";
  }

  /**
   * Redraw the map and park it in the top-right of the screen.
   * `navigableBounds` must be the exact world AABB used for pan + min-zoom.
   */
  update(
    nodes: RenderNode[],
    camera: CameraState,
    screenWidth: number,
    screenHeight: number,
    displayPositions: Map<string, { x: number; y: number }>,
    focusNodeId: string | null,
    navigableBounds: WorldBounds | null,
  ): boolean {
    const plotted: PlotNode[] = [];
    for (const node of nodes) {
      if (!node.embeddingReady) {
        continue;
      }
      const displayed = displayPositions.get(node.id);
      plotted.push({
        id: node.id,
        x: displayed?.x ?? node.x,
        y: displayed?.y ?? node.y,
        activation: node.activation,
        fontSize: node.fontSize,
      });
    }

    if (plotted.length === 0 || !navigableBounds) {
      this.container.visible = false;
      this.transform = null;
      return false;
    }

    this.container.visible = true;
    this.layout.width = MINIMAP_CONFIG.width;
    this.layout.height = MINIMAP_CONFIG.height;
    this.layout.x = screenWidth - this.layout.width - MINIMAP_CONFIG.margin;
    this.layout.y = MINIMAP_CONFIG.margin;
    this.container.position.set(this.layout.x, this.layout.y);
    this.container.hitArea = new Rectangle(
      0,
      0,
      this.layout.width,
      this.layout.height,
    );

    this.transform = fitBounds(
      navigableBounds,
      this.layout.width,
      this.layout.height,
      MINIMAP_CONFIG.inset,
    );

    const { width, height } = this.layout;

    this.frame.clear();
    this.frame.rect(0.5, 0.5, width - 1, height - 1).stroke({
      width: 1,
      color: 0xffffff,
      alpha: 0.28,
    });

    this.dots.clear();
    for (const node of plotted) {
      const p = this.worldToMap(node.x, node.y);
      if (!p) {
        continue;
      }
      const isFocus = node.id === focusNodeId;
      const sizeBoost = Math.min(0.9, Math.max(0, (node.fontSize - 12) / 20));
      const radiusDot = isFocus ? 2.6 : 1.45 + sizeBoost * 0.7;
      const alpha = isFocus
        ? 1
        : 0.28 + Math.min(0.5, node.activation * 0.6);

      if (isFocus) {
        const halo = (radiusDot + 2.4) * 2;
        this.dots
          .rect(p.x - halo / 2, p.y - halo / 2, halo, halo)
          .fill({ color: 0xffffff, alpha: 0.14 });
      }
      const size = radiusDot * 2;
      this.dots.rect(p.x - size / 2, p.y - size / 2, size, size).fill({
        color: 0xffffff,
        alpha,
      });
    }

    this.viewport.clear();
    const view = this.viewportRect(camera, screenWidth, screenHeight);
    if (view) {
      this.viewport
        .rect(view.x, view.y, view.width, view.height)
        .fill({ color: 0xffffff, alpha: 0.05 })
        .stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
    }

    return true;
  }

  containsScreenPoint(screenX: number, screenY: number): boolean {
    if (!this.container.visible) {
      return false;
    }
    return (
      screenX >= this.layout.x &&
      screenX <= this.layout.x + this.layout.width &&
      screenY >= this.layout.y &&
      screenY <= this.layout.y + this.layout.height
    );
  }

  /** Map a canvas point to world coordinates (clamped to the plotted map). */
  screenToWorld(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } | null {
    if (!this.transform) {
      return null;
    }
    const left = this.transform.originX;
    const top = this.transform.originY;
    const right = left + this.transform.contentWidth;
    const bottom = top + this.transform.contentHeight;
    const localX = Math.min(
      right,
      Math.max(left, screenX - this.layout.x),
    );
    const localY = Math.min(
      bottom,
      Math.max(top, screenY - this.layout.y),
    );
    return {
      x:
        (localX - this.transform.originX) / this.transform.scale +
        this.transform.bounds.minX,
      y:
        (localY - this.transform.originY) / this.transform.scale +
        this.transform.bounds.minY,
    };
  }

  private worldToMap(
    worldX: number,
    worldY: number,
  ): { x: number; y: number } | null {
    if (!this.transform) {
      return null;
    }
    return {
      x:
        this.transform.originX +
        (worldX - this.transform.bounds.minX) * this.transform.scale,
      y:
        this.transform.originY +
        (worldY - this.transform.bounds.minY) * this.transform.scale,
    };
  }

  private viewportRect(
    camera: CameraState,
    screenWidth: number,
    screenHeight: number,
  ): { x: number; y: number; width: number; height: number } | null {
    if (!this.transform) {
      return null;
    }

    const halfW = screenWidth / (2 * camera.scale);
    const halfH = screenHeight / (2 * camera.scale);
    const corners = [
      this.worldToMap(camera.x - halfW, camera.y - halfH),
      this.worldToMap(camera.x + halfW, camera.y - halfH),
      this.worldToMap(camera.x + halfW, camera.y + halfH),
      this.worldToMap(camera.x - halfW, camera.y + halfH),
    ];
    if (corners.some((corner) => !corner)) {
      return null;
    }

    const xs = corners.map((corner) => corner!.x);
    const ys = corners.map((corner) => corner!.y);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // Intersect with the plotted world rect only (not letterbox chrome).
    const left = this.transform.originX;
    const top = this.transform.originY;
    const rightBound = left + this.transform.contentWidth;
    const bottomBound = top + this.transform.contentHeight;

    minX = Math.max(left, minX);
    minY = Math.max(top, minY);
    maxX = Math.min(rightBound, maxX);
    maxY = Math.min(bottomBound, maxY);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width < 1 || height < 1) {
      return null;
    }

    return { x: minX, y: minY, width, height };
  }
}

function fitBounds(
  bounds: WorldBounds,
  width: number,
  height: number,
  inset: number,
): MapTransform {
  const worldW = Math.max(1, bounds.maxX - bounds.minX);
  const worldH = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(
    (width - inset * 2) / worldW,
    (height - inset * 2) / worldH,
  );
  const mappedW = worldW * scale;
  const mappedH = worldH * scale;
  return {
    bounds,
    scale,
    originX: (width - mappedW) / 2,
    originY: (height - mappedH) / 2,
    contentWidth: mappedW,
    contentHeight: mappedH,
  };
}
