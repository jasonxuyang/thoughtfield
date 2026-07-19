import type { Community, WordEdge, WordNode } from "../graph/graph-types";
import { LAYOUT_CONFIG } from "./layout-config";
import { clampVelocity } from "./layout-config";

/** Skip far-pair repulsion — dominant cost was O(n²) hypot calls. */
const REPULSION_CELL = 220;
const REPULSION_RANGE = REPULSION_CELL * 1.6;
/** Soft-cap summed forces so overlap spikes don't yank nodes. */
const MAX_NODE_FORCE = 10;
/** Softens 1/r² near-field spikes (was `+ 1`). */
const REPULSION_SOFTEN = 90;

function edgeDistance(combinedWeight: number): number {
  return (
    LAYOUT_CONFIG.edgeBaseDistance -
    combinedWeight * LAYOUT_CONFIG.edgeWeightDistanceScale
  );
}

function deterministicJiggle(aId: string, bId: string): { dx: number; dy: number } {
  let hash = 2166136261;
  const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) % 10_000) / 10_000 * Math.PI * 2;
  return {
    dx: Math.cos(angle) * 0.01,
    dy: Math.sin(angle) * 0.01,
  };
}

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

export function stepNodeLayout(
  nodes: WordNode[],
  edges: WordEdge[],
  communitiesById: Map<string, Community>,
  dt: number = 1,
): void {
  if (nodes.length === 0) {
    return;
  }

  const forces = new Map<string, { fx: number; fy: number }>();
  const byId = new Map<string, WordNode>();
  for (const node of nodes) {
    forces.set(node.id, { fx: 0, fy: 0 });
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    const force = forces.get(node.id)!;
    if (node.communityId) {
      const community = communitiesById.get(node.communityId);
      if (community) {
        const dx = community.anchorX - node.x;
        const dy = community.anchorY - node.y;
        const attraction = LAYOUT_CONFIG.nodeAnchorAttraction;
        force.fx += dx * attraction;
        force.fy += dy * attraction;
      }
    }
  }

  // Spatial hash: only repel nearby pairs.
  const grid = new Map<string, WordNode[]>();
  for (const node of nodes) {
    const cx = Math.floor(node.x / REPULSION_CELL);
    const cy = Math.floor(node.y / REPULSION_CELL);
    const key = cellKey(cx, cy);
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      grid.set(key, [node]);
    }
  }

  for (const node of nodes) {
    const cx = Math.floor(node.x / REPULSION_CELL);
    const cy = Math.floor(node.y / REPULSION_CELL);
    const fa = forces.get(node.id)!;

    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get(cellKey(cx + ox, cy + oy));
        if (!bucket) {
          continue;
        }
        for (const other of bucket) {
          if (other.id <= node.id) {
            continue;
          }

          let dx = other.x - node.x;
          let dy = other.y - node.y;
          let dist = Math.hypot(dx, dy);
          if (dist > REPULSION_RANGE) {
            continue;
          }

          if (dist < 1e-3) {
            const jiggle = deterministicJiggle(node.id, other.id);
            dx = jiggle.dx;
            dy = jiggle.dy;
            dist = Math.hypot(dx, dy);
          }

          const nx = dx / dist;
          const ny = dy / dist;
          const repulsion =
            LAYOUT_CONFIG.nodeRepulsion / (dist * dist + REPULSION_SOFTEN);
          const fb = forces.get(other.id)!;
          fa.fx -= nx * repulsion;
          fa.fy -= ny * repulsion;
          fb.fx += nx * repulsion;
          fb.fy += ny * repulsion;

          const minDist =
            (node.textWidth + other.textWidth) * 0.35 +
            LAYOUT_CONFIG.nodeRadius * 0.2;
          if (dist < minDist) {
            const push = (minDist - dist) * 0.16;
            fa.fx -= nx * push;
            fa.fy -= ny * push;
            fb.fx += nx * push;
            fb.fy += ny * push;
          }
        }
      }
    }
  }

  for (const edge of edges) {
    const a = byId.get(edge.sourceId);
    const b = byId.get(edge.targetId);
    if (!a || !b) {
      continue;
    }

    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 1e-3) {
      dist = 1e-3;
    }

    const desired = edgeDistance(edge.combinedWeight);
    const crossCommunity =
      !!a.communityId &&
      !!b.communityId &&
      a.communityId !== b.communityId;
    const springScale = crossCommunity
      ? LAYOUT_CONFIG.crossCommunitySpringScale
      : 1;
    const spring =
      (dist - desired) *
      LAYOUT_CONFIG.nodeSpringStrength *
      (0.5 + edge.combinedWeight) *
      springScale;
    const nx = dx / dist;
    const ny = dy / dist;
    const fa = forces.get(a.id)!;
    const fb = forces.get(b.id)!;
    fa.fx += nx * spring;
    fa.fy += ny * spring;
    fb.fx -= nx * spring;
    fb.fy -= ny * spring;
  }

  const sleep = LAYOUT_CONFIG.velocitySleep;
  for (const node of nodes) {
    const force = forces.get(node.id)!;
    const forceMag = Math.hypot(force.fx, force.fy);
    if (forceMag > MAX_NODE_FORCE) {
      const scale = MAX_NODE_FORCE / forceMag;
      force.fx *= scale;
      force.fy *= scale;
    }
    node.vx = (node.vx + force.fx * dt) * LAYOUT_CONFIG.damping;
    node.vy = (node.vy + force.fy * dt) * LAYOUT_CONFIG.damping;
    const clamped = clampVelocity(node.vx, node.vy);
    node.vx = clamped.vx;
    node.vy = clamped.vy;
    // Park fully once the chatter is below the sleep floor.
    if (Math.hypot(node.vx, node.vy) < sleep) {
      node.vx = 0;
      node.vy = 0;
      continue;
    }
    node.x += node.vx * dt;
    node.y += node.vy * dt;
  }
}

export function estimateTextBounds(
  label: string,
  fontSize: number,
): { width: number; height: number } {
  const count = Math.max(1, [...label].length);
  const areaPerLetter = (fontSize * 0.95) ** 2;
  const radius = Math.max(
    fontSize * 1.85,
    Math.sqrt((count * areaPerLetter) / (4 * Math.PI)) * 2.2,
  );
  const diameter = radius * 2.5;
  return {
    width: diameter,
    height: diameter,
  };
}

export function fontSizeForOccurrences(occurrenceCount: number): number {
  return 16 + Math.min(12, Math.log1p(occurrenceCount) * 2);
}
