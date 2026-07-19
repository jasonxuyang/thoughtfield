import { BitmapText, Container } from "pixi.js";
import type { RenderEdge, RenderNode } from "../graph/graph-types";
import { VIZ_EDGE_CONFIG } from "../config/algorithms";
import {
  ACTIVATION_INACTIVE_COLOR,
  activationColorAtZoom,
  activationHeat,
  farZoomRestLift,
} from "./activation-style";
import { LETTER_BITMAP_FONT } from "./bitmap-fonts";
import {
  segmentIntersectsBounds,
  type WorldBounds,
} from "./camera";

export const EDGE_STRING_CONFIG = {
  minWeight: VIZ_EDGE_CONFIG.minWeight,
  maxNewEdgesPerFrame: 3,
  /** Used while the entry preview is up so strands appear promptly. */
  previewMaxNewEdgesPerFrame: 20,
  minLetters: 9,
  maxLetters: 42,
  /** Base glyph size; thickness scales this up for strong edges. */
  fontSize: 5,
  endInset: 28,
  /** World units between letters at weight ~0 (stronger → denser). */
  baseSpacing: 15,
  minSpacing: 7.5,
  waveAmplitude: 3.5,
  /**
   * Crawl rate along the chord. `flow` accumulates as dt * flowSpeed;
   * letters wrap when they reach an endpoint (full loop ≈ 1 / crawlRate sec
   * at flowSpeed = 1).
   */
  crawlRate: 0.1,
  /** How fast letters / pulse travel along a strand. */
  baseFlowSpeed: 0.55,
};

type StrandMorphology = {
  /** Normalized combined weight 0..1. */
  weight: number;
  /** 1 = semantic-heavy, 0 = colocation-heavy. */
  semanticRatio: number;
  /** Activation heat on the bridge. */
  heat: number;
  /** Letter spacing in world units (lower = denser). */
  spacing: number;
  /** BitmapText scale (thicker / stronger). */
  thickness: number;
  /** Sideways wave size. */
  waveAmplitude: number;
  /** Travel speed along the strand. */
  flowSpeed: number;
};

type EdgeGlyph = {
  id: string;
  root: Container;
  letters: BitmapText[];
  sourceLabel: string;
  targetLabel: string;
  labelKey: string;
  lastTint: number;
  /** Accumulated flow phase for animation. */
  flow: number;
};

/**
 * Letter strands along strong graph edges.
 * Morphology (density / thickness / motion) tracks weight, mix, and activation.
 */
export class EdgeStringDisplay {
  readonly container = new Container();
  private glyphs = new Map<string, EdgeGlyph>();
  private nodeIndex = new Map<string, RenderNode>();
  private rapidSpawn = false;

  /** Faster strand creation during the non-interactive entry preview. */
  setRapidSpawn(enabled: boolean): void {
    this.rapidSpawn = enabled;
  }

  update(
    edges: RenderEdge[],
    nodes: RenderNode[],
    displayPositions: Map<string, { x: number; y: number }>,
    dt: number,
    viewport: WorldBounds | null = null,
    cameraScale = 1,
  ): void {
    this.nodeIndex.clear();
    for (const node of nodes) {
      this.nodeIndex.set(node.id, node);
    }

    const zoomLift = farZoomRestLift(cameraScale);
    const ranked: RenderEdge[] = [];
    for (const edge of edges) {
      const a = this.nodeIndex.get(edge.sourceId);
      const b = this.nodeIndex.get(edge.targetId);
      if (!a?.embeddingReady || !b?.embeddingReady) {
        continue;
      }

      const hot =
        a.activation >= VIZ_EDGE_CONFIG.activationPriority ||
        b.activation >= VIZ_EDGE_CONFIG.activationPriority;
      const minWeight = hot
        ? VIZ_EDGE_CONFIG.activeMinWeight
        : VIZ_EDGE_CONFIG.minWeight;
      if (edge.combinedWeight < minWeight) {
        continue;
      }
      ranked.push(edge);
    }

    ranked.sort((a, b) => b.combinedWeight - a.combinedWeight);

    const seen = new Set<string>();
    let newEdgeBudget = this.rapidSpawn
      ? EDGE_STRING_CONFIG.previewMaxNewEdgesPerFrame
      : EDGE_STRING_CONFIG.maxNewEdgesPerFrame;
    const wavePad = EDGE_STRING_CONFIG.waveAmplitude + 8;

    for (const edge of ranked) {
      const source = this.nodeIndex.get(edge.sourceId)!;
      const target = this.nodeIndex.get(edge.targetId)!;
      const a = displayPositions.get(source.id) ?? {
        x: source.x,
        y: source.y,
      };
      const b = displayPositions.get(target.id) ?? {
        x: target.x,
        y: target.y,
      };

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < EDGE_STRING_CONFIG.endInset * 2 + 8) {
        continue;
      }

      const inView =
        viewport === null ||
        segmentIntersectsBounds(
          a.x,
          a.y,
          b.x,
          b.y,
          {
            minX: viewport.minX - wavePad,
            maxX: viewport.maxX + wavePad,
            minY: viewport.minY - wavePad,
            maxY: viewport.maxY + wavePad,
          },
        );

      const heat = edgeHeat(
        source.activation,
        target.activation,
        edge.combinedWeight,
      );
      const morph = morphologyFromEdge(edge, heat);

      const labelKey = `${source.label}|${target.label}`;
      let glyph = this.glyphs.get(edge.id);
      if (!glyph || glyph.labelKey !== labelKey) {
        // Defer building strands the camera can't see yet.
        if (!inView) {
          if (glyph) {
            seen.add(edge.id);
            glyph.root.visible = false;
          }
          continue;
        }
        if (newEdgeBudget <= 0) {
          if (glyph) {
            seen.add(edge.id);
          }
          continue;
        }
        newEdgeBudget -= 1;
        if (glyph) {
          this.destroyGlyph(glyph);
        }
        const initialLetters = letterCountForDistance(dist, morph.spacing);
        glyph = this.createGlyph(
          edge.id,
          source.label,
          target.label,
          labelKey,
          initialLetters,
        );
        this.glyphs.set(edge.id, glyph);
        this.container.addChild(glyph.root);
      }

      seen.add(edge.id);
      glyph.flow += dt * morph.flowSpeed;

      if (!inView) {
        glyph.root.visible = false;
        continue;
      }

      glyph.root.visible = true;

      const used = letterCountForDistance(dist, morph.spacing);
      this.ensureLetterCount(glyph, used);
      const tint = activationColorAtZoom(heat, cameraScale);
      const baseAlpha =
        0.12 +
        zoomLift * 0.16 +
        morph.weight * 0.22 +
        activationHeat(heat) * 0.75;

      glyph.root.position.set(a.x, a.y);
      glyph.root.rotation = Math.atan2(dy, dx);

      const inset = EDGE_STRING_CONFIG.endInset;
      const usable = dist - inset * 2;
      const phase = hashUnit(edge.id) * Math.PI * 2;

      if (tint !== glyph.lastTint) {
        glyph.lastTint = tint;
        for (const letter of glyph.letters) {
          letter.tint = tint;
        }
      }

      // Whole lattice slides along the chord; wrap at the ends.
      const crawl = wrap01(glyph.flow * EDGE_STRING_CONFIG.crawlRate);

      for (let i = 0; i < used; i += 1) {
        const letter = glyph.letters[i]!;
        letter.visible = true;

        const slot = (i + 1) / (used + 1);
        const t = wrap01(slot + crawl);
        const along = inset + usable * t;

        // Colocation links sway more; semantic stay tighter; heat wakes them up.
        const wave =
          Math.sin(phase + t * Math.PI * 2.4 + glyph.flow * 0.85) *
          morph.waveAmplitude;
        letter.position.set(along, wave);

        // Soft traveling highlight — secondary to the crawl motion.
        const pulse =
          0.72 + 0.28 * Math.sin(glyph.flow * 1.35 - t * Math.PI * 2);
        letter.alpha = Math.min(1, baseAlpha * pulse);
        letter.scale.set(morph.thickness * (0.94 + pulse * 0.08));
      }

      // Hide surplus if the chord shortened (capacity stays for reuse).
      for (let i = used; i < glyph.letters.length; i += 1) {
        glyph.letters[i]!.visible = false;
      }
    }

    for (const [id, glyph] of this.glyphs) {
      if (!seen.has(id)) {
        this.destroyGlyph(glyph);
        this.glyphs.delete(id);
      }
    }
  }

  private createGlyph(
    id: string,
    sourceLabel: string,
    targetLabel: string,
    labelKey: string,
    letterCount: number,
  ): EdgeGlyph {
    const root = new Container();
    const count = Math.max(
      EDGE_STRING_CONFIG.minLetters,
      Math.min(EDGE_STRING_CONFIG.maxLetters, letterCount),
    );
    const glyph: EdgeGlyph = {
      id,
      root,
      letters: [],
      sourceLabel,
      targetLabel,
      labelKey,
      lastTint: ACTIVATION_INACTIVE_COLOR,
      flow: hashUnit(id) * Math.PI * 2,
    };
    this.ensureLetterCount(glyph, count);
    return glyph;
  }

  /** Grow strand capacity up to `count` (never shrinks — surplus stays hidden). */
  private ensureLetterCount(glyph: EdgeGlyph, count: number): void {
    const target = Math.max(
      EDGE_STRING_CONFIG.minLetters,
      Math.min(EDGE_STRING_CONFIG.maxLetters, count),
    );
    while (glyph.letters.length < target) {
      const index = glyph.letters.length;
      const text = new BitmapText({
        text: letterCharAt(
          glyph.sourceLabel,
          glyph.targetLabel,
          glyph.id,
          index,
        ),
        style: {
          fontFamily: LETTER_BITMAP_FONT,
          fontSize: EDGE_STRING_CONFIG.fontSize,
        },
      });
      text.anchor.set(0.5);
      text.tint = glyph.lastTint;
      text.visible = false;
      glyph.root.addChild(text);
      glyph.letters.push(text);
    }
  }

  private destroyGlyph(glyph: EdgeGlyph): void {
    this.container.removeChild(glyph.root);
    glyph.root.destroy({ children: true });
  }
}

function morphologyFromEdge(
  edge: RenderEdge,
  heat: number,
): StrandMorphology {
  const weight = clamp01(edge.combinedWeight);
  const affinity = edge.semanticScore + edge.colocationScore;
  const semanticRatio =
    affinity > 1e-6 ? clamp01(edge.semanticScore / affinity) : 0.5;

  // Stronger → denser packing.
  const spacing =
    EDGE_STRING_CONFIG.baseSpacing -
    weight * (EDGE_STRING_CONFIG.baseSpacing - EDGE_STRING_CONFIG.minSpacing);

  // Stronger / hotter → thicker glyphs.
  const thickness = 0.82 + weight * 0.7 + heat * 0.35;

  // Colocation (low semantic) sways more; semantic stays rope-like.
  const waveAmplitude =
    EDGE_STRING_CONFIG.waveAmplitude *
    (0.45 + (1 - semanticRatio) * 0.75 + heat * 0.55);

  // Hot, heavy bridges crawl faster.
  const flowSpeed =
    EDGE_STRING_CONFIG.baseFlowSpeed *
    (0.55 + weight * 0.9 + heat * 1.4);

  return {
    weight,
    semanticRatio,
    heat,
    spacing,
    thickness,
    waveAmplitude,
    flowSpeed,
  };
}

function edgeHeat(
  sourceActivation: number,
  targetActivation: number,
  weight: number,
): number {
  const endpoint = Math.max(sourceActivation, targetActivation);
  const bridge =
    endpoint * 0.75 + Math.min(sourceActivation, targetActivation) * 0.25;
  return Math.min(1, bridge * (0.45 + weight * 0.7));
}

function letterCountForDistance(dist: number, spacing: number): number {
  const usable = Math.max(0, dist - EDGE_STRING_CONFIG.endInset * 2);
  const byDist = Math.round(usable / Math.max(6, spacing));
  return Math.max(
    EDGE_STRING_CONFIG.minLetters,
    Math.min(EDGE_STRING_CONFIG.maxLetters, byDist),
  );
}

/** Deterministic strand letter at index — stable as capacity grows. */
function letterCharAt(
  sourceLabel: string,
  targetLabel: string,
  edgeId: string,
  index: number,
): string {
  const sourceChars = [...sourceLabel]
    .map((char) => char.toLowerCase())
    .filter((char) => /[a-z0-9]/.test(char));
  const targetChars = [...targetLabel]
    .map((char) => char.toLowerCase())
    .filter((char) => /[a-z0-9]/.test(char));
  const pool =
    sourceChars.length + targetChars.length > 0
      ? [...sourceChars, ...targetChars]
      : ["a"];

  let state = hashUnit(edgeId) * 1_000_000;
  for (let i = 0; i <= index; i += 1) {
    state = (state * 1664525 + 1013904223) % 4294967296;
  }
  const side = index % 2 === 0 ? sourceChars : targetChars;
  const pickFrom = side.length > 0 ? side : pool;
  return pickFrom[Math.floor(state) % pickFrom.length]!;
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wrap01(value: number): number {
  return value - Math.floor(value);
}
