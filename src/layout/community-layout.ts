import {
  communityAffinity,
  desiredCommunityDistance,
} from "../graph/community-affinity";
import type { Community, WordEdge, WordNode } from "../graph/graph-types";
import {
  embeddingDirection2d,
  memberSpatialCentroid,
} from "./community-placement";
import { clampVelocity, LAYOUT_CONFIG } from "./layout-config";

/** Soft tether toward member COM when members drift far from the anchor. */
const MEMBER_TETHER = 0.03;
const MEMBER_TETHER_MIN_DIST = 64;
/** Cap per-tick force so overlap / repulsion never pops the field. */
const MAX_COMMUNITY_FORCE = 18;

export function stepCommunityLayout(
  communities: Community[],
  edges: WordEdge[],
  nodes: Map<string, WordNode>,
  dt: number = 1,
): void {
  if (communities.length === 0) {
    return;
  }

  const forces = communities.map(() => ({ fx: 0, fy: 0 }));

  for (let i = 0; i < communities.length; i += 1) {
    for (let j = i + 1; j < communities.length; j += 1) {
      const a = communities[i]!;
      const b = communities[j]!;
      let dx = b.anchorX - a.anchorX;
      let dy = b.anchorY - a.anchorY;
      let dist = Math.hypot(dx, dy);

      if (dist < 1e-3) {
        if (a.centroidEmbedding && b.centroidEmbedding) {
          const dir = embeddingDirection2d(
            a.centroidEmbedding,
            b.centroidEmbedding,
          );
          dx = dir.x;
          dy = dir.y;
        } else {
          dx = 1;
          dy = 0;
        }
        dist = 1;
      }

      const nx = dx / dist;
      const ny = dy / dist;

      const affinity = communityAffinity(a, b, edges);
      const minDist = a.radius + b.radius + LAYOUT_CONFIG.communityPadding;
      const desired = Math.max(minDist, desiredCommunityDistance(affinity));

      const spring = (dist - desired) * LAYOUT_CONFIG.communitySpringStrength;
      forces[i]!.fx += nx * spring;
      forces[i]!.fy += ny * spring;
      forces[j]!.fx -= nx * spring;
      forces[j]!.fy -= ny * spring;

      const repulsion =
        LAYOUT_CONFIG.communityRepulsion / (dist * dist + 1);
      forces[i]!.fx -= nx * repulsion;
      forces[i]!.fy -= ny * repulsion;
      forces[j]!.fx += nx * repulsion;
      forces[j]!.fy += ny * repulsion;

      if (dist < minDist) {
        // Soft separation — former 1.25× push caused visible pops.
        const push = (minDist - dist) * 0.35;
        forces[i]!.fx -= nx * push;
        forces[i]!.fy -= ny * push;
        forces[j]!.fx += nx * push;
        forces[j]!.fy += ny * push;
      }
    }
  }

  for (let i = 0; i < communities.length; i += 1) {
    const community = communities[i]!;
    const force = forces[i]!;
    const forceMag = Math.hypot(force.fx, force.fy);
    if (forceMag > MAX_COMMUNITY_FORCE) {
      const scale = MAX_COMMUNITY_FORCE / forceMag;
      force.fx *= scale;
      force.fy *= scale;
    }

    community.anchorVx =
      (community.anchorVx + force.fx * dt) * LAYOUT_CONFIG.damping;
    community.anchorVy =
      (community.anchorVy + force.fy * dt) * LAYOUT_CONFIG.damping;
    const clamped = clampVelocity(
      community.anchorVx,
      community.anchorVy,
      LAYOUT_CONFIG.communityMaxVelocity,
    );
    community.anchorVx = clamped.vx;
    community.anchorVy = clamped.vy;
    community.anchorX += community.anchorVx * dt;
    community.anchorY += community.anchorVy * dt;

    const memberCom = memberSpatialCentroid(community.nodeIds, nodes, true);
    if (memberCom) {
      const tetherDist = Math.hypot(
        memberCom.x - community.anchorX,
        memberCom.y - community.anchorY,
      );
      if (tetherDist > MEMBER_TETHER_MIN_DIST) {
        community.anchorX += (memberCom.x - community.anchorX) * MEMBER_TETHER;
        community.anchorY += (memberCom.y - community.anchorY) * MEMBER_TETHER;
      }
    }
  }
}

export { placeCommunityAnchorFromGraph } from "./community-placement";
