export type CameraState = {
  x: number;
  y: number;
  scale: number;
};

export type WorldBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/** How far past the content AABB the camera focus may travel. */
export const CAMERA_PAN_LIMIT = {
  /** Padding around each node for letter-sphere footprint. */
  nodePadding: 140,
  /** Extra world-units beyond content bounds before pan hard-stops. */
  maxOverscroll: 80,
  /** When the graph is empty, keep the camera near the origin. */
  emptyGraphRadius: 200,
};

export function createCamera(): CameraState {
  return { x: 0, y: 0, scale: 1 };
}

export function screenToWorld(
  camera: CameraState,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (screenX - width / 2) / camera.scale + camera.x,
    y: (screenY - height / 2) / camera.scale + camera.y,
  };
}

export function worldToScreen(
  camera: CameraState,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.scale + width / 2,
    y: (worldY - camera.y) * camera.scale + height / 2,
  };
}

/**
 * World-space rect currently covered by the screen, plus a pixel margin
 * converted to world units so spheres/strands don't pop at the edges.
 */
export function worldViewportBounds(
  camera: CameraState,
  width: number,
  height: number,
  marginPx = 80,
): WorldBounds {
  const margin = marginPx / Math.max(0.0001, camera.scale);
  const halfW = width / (2 * camera.scale);
  const halfH = height / (2 * camera.scale);
  return {
    minX: camera.x - halfW - margin,
    maxX: camera.x + halfW + margin,
    minY: camera.y - halfH - margin,
    maxY: camera.y + halfH + margin,
  };
}

export function circleIntersectsBounds(
  x: number,
  y: number,
  radius: number,
  bounds: WorldBounds,
): boolean {
  const nearestX = Math.min(bounds.maxX, Math.max(bounds.minX, x));
  const nearestY = Math.min(bounds.maxY, Math.max(bounds.minY, y));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

/** True if the segment overlaps the AABB (including when both ends are outside). */
export function segmentIntersectsBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bounds: WorldBounds,
): boolean {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (
    maxX < bounds.minX ||
    minX > bounds.maxX ||
    maxY < bounds.minY ||
    minY > bounds.maxY
  ) {
    return false;
  }

  if (
    pointInBounds(x1, y1, bounds) ||
    pointInBounds(x2, y2, bounds)
  ) {
    return true;
  }

  return (
    segmentsIntersect(
      x1,
      y1,
      x2,
      y2,
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.minY,
    ) ||
    segmentsIntersect(
      x1,
      y1,
      x2,
      y2,
      bounds.minX,
      bounds.maxY,
      bounds.maxX,
      bounds.maxY,
    ) ||
    segmentsIntersect(
      x1,
      y1,
      x2,
      y2,
      bounds.minX,
      bounds.minY,
      bounds.minX,
      bounds.maxY,
    ) ||
    segmentsIntersect(
      x1,
      y1,
      x2,
      y2,
      bounds.maxX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
    )
  );
}

function pointInBounds(x: number, y: number, bounds: WorldBounds): boolean {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    y >= bounds.minY &&
    y <= bounds.maxY
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const acx = cx - ax;
  const acy = cy - ay;
  const adx = dx - ax;
  const ady = dy - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const cax = ax - cx;
  const cay = ay - cy;
  const cbx = bx - cx;
  const cby = by - cy;

  const cross = (ux: number, uy: number, vx: number, vy: number) =>
    ux * vy - uy * vx;

  const d1 = cross(abx, aby, acx, acy);
  const d2 = cross(abx, aby, adx, ady);
  const d3 = cross(cdx, cdy, cax, cay);
  const d4 = cross(cdx, cdy, cbx, cby);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

export function applyCameraTransform(
  camera: CameraState,
  width: number,
  height: number,
): { x: number; y: number; scale: number } {
  return {
    x: width / 2 - camera.x * camera.scale,
    y: height / 2 - camera.y * camera.scale,
    scale: camera.scale,
  };
}

/** Absolute zoom ceilings — the live floor is computed from field bounds. */
export const CAMERA_ZOOM = {
  minScale: 0.05,
  maxScale: 4,
};

/**
 * Scale at which `bounds` exactly fills the screen. Smaller scale = more
 * zoomed out; use this as the floor so "fully out" matches the minimap.
 */
export function minScaleToFitBounds(
  bounds: WorldBounds,
  width: number,
  height: number,
  paddingPx = 0,
): number {
  const worldW = Math.max(1, bounds.maxX - bounds.minX);
  const worldH = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, width - paddingPx * 2);
  const availH = Math.max(1, height - paddingPx * 2);
  return Math.min(availW / worldW, availH / worldH);
}

export function zoomAt(
  camera: CameraState,
  factor: number,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
  scaleRange: { min: number; max: number } = {
    min: CAMERA_ZOOM.minScale,
    max: CAMERA_ZOOM.maxScale,
  },
): CameraState {
  const before = screenToWorld(camera, screenX, screenY, width, height);
  const nextScale = Math.min(
    scaleRange.max,
    Math.max(scaleRange.min, camera.scale * factor),
  );
  const next: CameraState = { ...camera, scale: nextScale };
  const after = screenToWorld(next, screenX, screenY, width, height);
  return {
    x: camera.x + (before.x - after.x),
    y: camera.y + (before.y - after.y),
    scale: nextScale,
  };
}

export function panCamera(
  camera: CameraState,
  dx: number,
  dy: number,
): CameraState {
  return {
    ...camera,
    x: camera.x - dx / camera.scale,
    y: camera.y - dy / camera.scale,
  };
}

export function resetCamera(): CameraState {
  return createCamera();
}

export function contentBoundsFromNodes(
  nodes: Array<{ x: number; y: number; fontSize?: number }>,
): WorldBounds | null {
  if (nodes.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const pad =
      CAMERA_PAN_LIMIT.nodePadding + Math.max(0, node.fontSize ?? 16) * 1.5;
    minX = Math.min(minX, node.x - pad);
    maxX = Math.max(maxX, node.x + pad);
    minY = Math.min(minY, node.y - pad);
    maxY = Math.max(maxY, node.y + pad);
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Center + zoom so the given world AABB fills the screen (with padding).
 * Used by the entry preview to keep every community in view.
 */
export function cameraToFitBounds(
  bounds: WorldBounds,
  width: number,
  height: number,
  options: {
    paddingPx?: number;
    minScale?: number;
    maxScale?: number;
    /** Applied after the fit (e.g. 0.94 for a little breathing room). */
    scaleFactor?: number;
  } = {},
): CameraState {
  const paddingPx = options.paddingPx ?? 72;
  const minScale = options.minScale ?? 0.12;
  const maxScale = options.maxScale ?? 1.15;
  const scaleFactor = options.scaleFactor ?? 1;
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(1, width - paddingPx * 2);
  const availH = Math.max(1, height - paddingPx * 2);
  const scale = Math.min(
    maxScale,
    Math.max(
      minScale,
      Math.min(availW / contentW, availH / contentH) * scaleFactor,
    ),
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    scale,
  };
}

/**
 * Tight AABB for overview framing — pads by visual sphere size, not the
 * generous pan-limit padding used for interaction clamps.
 */
export function contentBoundsForOverview(
  nodes: Array<{ x: number; y: number; radius: number }>,
): WorldBounds | null {
  if (nodes.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const pad = Math.max(24, node.radius);
    minX = Math.min(minX, node.x - pad);
    maxX = Math.max(maxX, node.x + pad);
    minY = Math.min(minY, node.y - pad);
    maxY = Math.max(maxY, node.y + pad);
  }

  return { minX, maxX, minY, maxY };
}

/** Grow a world AABB uniformly (shared by minimap framing + pan limits). */
export function expandWorldBounds(
  bounds: WorldBounds,
  pad: number,
): WorldBounds {
  return {
    minX: bounds.minX - pad,
    maxX: bounds.maxX + pad,
    minY: bounds.minY - pad,
    maxY: bounds.maxY + pad,
  };
}

/**
 * Keep the camera from panning past the graph.
 * When `view` is provided, clamp so the visible rect stays inside `bounds`
 * (not just the focus point). Pass already-expanded navigable bounds with
 * `slack = 0` so the minimap / pan / min-zoom share one AABB.
 */
export function clampCameraToContent(
  camera: CameraState,
  bounds: WorldBounds | null,
  view?: { width: number; height: number },
  slack: number = CAMERA_PAN_LIMIT.maxOverscroll,
): CameraState {
  if (!bounds) {
    const r = CAMERA_PAN_LIMIT.emptyGraphRadius;
    return {
      ...camera,
      x: clamp(camera.x, -r, r),
      y: clamp(camera.y, -r, r),
    };
  }

  let minX = bounds.minX - slack;
  let maxX = bounds.maxX + slack;
  let minY = bounds.minY - slack;
  let maxY = bounds.maxY + slack;

  if (
    view &&
    view.width > 0 &&
    view.height > 0 &&
    camera.scale > 1e-6
  ) {
    const halfW = view.width / (2 * camera.scale);
    const halfH = view.height / (2 * camera.scale);
    // Pull the allowed focus range inward so the viewport edges stay in-bounds.
    // If the view is larger than the content, clamp() centers when max < min.
    minX += halfW;
    maxX -= halfW;
    minY += halfH;
    maxY -= halfH;
  }

  return {
    ...camera,
    x: clamp(camera.x, minX, maxX),
    y: clamp(camera.y, minY, maxY),
  };
}

/**
 * Clamp `proposed` into content bounds without teleporting from `previous`.
 * Home chase can sit slightly outside the pan AABB (edge focus / zoom); the
 * first pan must continue from that view and only resist further outward drift.
 */
export function clampCameraPan(
  previous: CameraState,
  proposed: CameraState,
  bounds: WorldBounds | null,
  view?: { width: number; height: number },
  slack: number = CAMERA_PAN_LIMIT.maxOverscroll,
): CameraState {
  const clampedProposed = clampCameraToContent(
    proposed,
    bounds,
    view,
    slack,
  );
  const clampedPrevious = clampCameraToContent(
    previous,
    bounds,
    view,
    slack,
  );

  const prevInside =
    nearlyEqual(previous.x, clampedPrevious.x) &&
    nearlyEqual(previous.y, clampedPrevious.y);

  if (prevInside) {
    return clampedProposed;
  }

  return {
    ...proposed,
    scale: clampedProposed.scale,
    x: resistOutward(previous.x, proposed.x, clampedProposed.x),
    y: resistOutward(previous.y, proposed.y, clampedProposed.y),
  };
}

function resistOutward(
  previous: number,
  proposed: number,
  limit: number,
): number {
  const prevErr = previous - limit;
  const propErr = proposed - limit;
  // Allow motion that reduces overflow; block motion that increases it.
  if (Math.abs(propErr) <= Math.abs(prevErr)) {
    return proposed;
  }
  return previous;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-4;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return (min + max) / 2;
  }
  return Math.min(max, Math.max(min, value));
}

/** Mutable velocity slot for SmoothDamp. */
export type SmoothVelocity = { v: number };

/**
 * Critically-damped smooth follow (Unity SmoothDamp-style).
 * Keeps continuous motion toward a moving target without exponential snap.
 */
export function smoothDamp(
  current: number,
  target: number,
  velocity: SmoothVelocity,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): number {
  const time = Math.max(0.0001, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const maxChange = maxSpeed * time;
  change = Math.min(maxChange, Math.max(-maxChange, change));

  const temp = (velocity.v + omega * change) * dt;
  velocity.v = (velocity.v - omega * temp) * exp;
  let output = current - change + (change + temp) * exp;

  // Don't overshoot the target.
  if (target - current > 0 === output > target) {
    output = target;
    velocity.v = 0;
  }

  return output;
}
