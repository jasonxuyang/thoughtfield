import {
  communityAffinity,
  desiredCommunityDistance,
} from "../graph/community-affinity";
import type { Community, WordEdge, WordNode } from "../graph/graph-types";
import { LAYOUT_CONFIG } from "./layout-config";

/**
 * Deterministic unit direction from two embedding centroids.
 * Sketches the high-D difference onto a fixed 2D plane (not RNG).
 */
export function embeddingDirection2d(
  a: Float32Array,
  b: Float32Array,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const delta = a[i]! - b[i]!;
    const angle = i * 2.399963;
    x += delta * Math.cos(angle);
    y += delta * Math.sin(angle);
  }
  const magnitude = Math.hypot(x, y);
  if (magnitude < 1e-8) {
    return { x: 1, y: 0 };
  }
  return { x: x / magnitude, y: y / magnitude };
}

export function memberSpatialCentroid(
  memberIds: string[],
  nodes: Map<string, WordNode>,
  onlyGraphPlaced = true,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let count = 0;

  for (const id of memberIds) {
    const node = nodes.get(id);
    if (!node) {
      continue;
    }
    if (onlyGraphPlaced && !node.graphPlaced) {
      continue;
    }
    x += node.x;
    y += node.y;
    count += 1;
  }

  if (count === 0) {
    return null;
  }
  return { x: x / count, y: y / count };
}

/**
 * Place a new community from graph structure:
 * 1) spatial centroid of its members (preferred)
 * 2) else push away from existing communities using embedding affinity
 *    for both distance and direction
 * 3) else park near the COM of existing anchors
 */
export function placeCommunityAnchorFromGraph(options: {
  community: Community;
  nodes: Map<string, WordNode>;
  existing: Community[];
  edges: WordEdge[];
}): { x: number; y: number } {
  const { community, nodes, existing, edges } = options;

  const memberCom = memberSpatialCentroid(community.nodeIds, nodes, true);
  if (memberCom) {
    return memberCom;
  }

  if (existing.length === 0) {
    return { x: 0, y: 0 };
  }

  let comX = 0;
  let comY = 0;
  for (const other of existing) {
    comX += other.anchorX;
    comY += other.anchorY;
  }
  comX /= existing.length;
  comY /= existing.length;

  let x = comX;
  let y = comY;

  for (const other of existing) {
    const affinity = communityAffinity(community, other, edges);
    const minDist =
      community.radius + other.radius + LAYOUT_CONFIG.communityPadding;
    const desired = Math.max(minDist, desiredCommunityDistance(affinity));

    let dx = x - other.anchorX;
    let dy = y - other.anchorY;
    let dist = Math.hypot(dx, dy);

    if (dist < 1e-3) {
      if (community.centroidEmbedding && other.centroidEmbedding) {
        const dir = embeddingDirection2d(
          community.centroidEmbedding,
          other.centroidEmbedding,
        );
        dx = dir.x;
        dy = dir.y;
      } else {
        const fallbackAngle = existing.indexOf(other) * 2.399963;
        dx = Math.cos(fallbackAngle);
        dy = Math.sin(fallbackAngle);
      }
      dist = 1;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    if (dist < desired) {
      x += nx * (desired - dist);
      y += ny * (desired - dist);
    }
  }

  return { x, y };
}
