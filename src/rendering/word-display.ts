import { BitmapText, Container, Graphics, Text } from "pixi.js";
import {
  ACTIVATION_CONFIG,
  RENDER_BUDGET_CONFIG,
  type AlgorithmSettings,
} from "../config/algorithms";
import type { GraphSnapshot, RenderNode } from "../graph/graph-types";
import { interpolateColor } from "../embeddings/vector-math";
import {
  ACTIVATION_ACTIVE_COLOR,
  ACTIVATION_INACTIVE_COLOR,
  activationColorAtZoom,
  activationHeat,
  farZoomRestLift,
} from "./activation-style";
import { LETTER_BITMAP_FONT } from "./bitmap-fonts";
import {
  circleIntersectsBounds,
  type WorldBounds,
} from "./camera";
import {
  buildLayeredLetterParticles,
  cubeSurfacePoints,
  easeOutCubic,
  fibonacciSpherePoints,
  lerpVec3,
  morphologyFromNode,
  projectPerspective,
  rotateX,
  rotateY,
  sphereRadiusForWord,
  spinPhaseFromId,
  type LetterParticle,
  type SphereMorphology,
  type Vec3,
} from "./letter-sphere";

const FOCAL_LENGTH = 300;
/** Soft radial expand from center — no left-to-right word wipe. */
const APPEAR_SECONDS = 0.55;
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };
/** Render letters smaller than layout font size so density can read. */
const LETTER_SIZE_SCALE = 0.34;
/** Concurrent coronal bursts per sphere. */
const MAX_STARS_PER_NODE = 2;
/** Rays per burst — fibonacci-distributed on the shell. */
const ARMS_PER_STAR = 7;
/** Letters along each ray. */
const BEADS_PER_ARM = 5;
/** Full-heat burst rate (stars / second). */
const STAR_EMIT_RATE = 0.7;
const STAR_MIN_LIFETIME = 2.0;
const STAR_MAX_LIFETIME = 2.8;
/** Stagger along a ray so it reads as a short trail. */
const ARM_BEAD_LAG = 0.065;

type LetterGlyph = {
  text: BitmapText;
  particle: LetterParticle;
  sphere: Vec3;
};

type WispBead = {
  text: BitmapText;
  /** Delay along the ray (head → tail). */
  lag: number;
};

type WispArm = {
  beads: WispBead[];
  /** Unit local direction on the shell. */
  outward: Vec3;
  /** Unit tangent for a mild coronal sweep. */
  tangent: Vec3;
};

/** 3D coronal burst — rays lift off the shell with the sphere's transform. */
type WispArc = {
  arms: WispArm[];
  age: number;
  lifetime: number;
  /** Mild tangential sweep (kept small — not a corkscrew). */
  sweep: number;
  r0: number;
  r1: number;
};

type WordGlyph = {
  root: Container;
  letters: LetterGlyph[];
  wisps: WispArc[];
  /** Fractional emit accumulator. */
  wispEmit: number;
  wispSerial: number;
  prevHeat: number;
  sourceChars: string[];
  age: number;
  spin: number;
  labelKey: string;
  lastFontSize: number;
  lastMorphKey: string;
  lastTint: number;
  sortClock: number;
  morph: SphereMorphology;
};

export class WordDisplay {
  readonly container = new Container();
  private glyphs = new Map<string, WordGlyph>();
  private displayPositions = new Map<string, { x: number; y: number }>();

  getDisplayPositions(): Map<string, { x: number; y: number }> {
    return this.displayPositions;
  }

  /** Nearest on-screen sphere under a world point, or null if none. */
  hitTest(worldX: number, worldY: number): string | null {
    return this.hitTestAt(worldX, worldY)?.id ?? null;
  }

  /** Hit details for cursor targeting — includes world center and radius. */
  hitTestAt(
    worldX: number,
    worldY: number,
  ): { id: string; x: number; y: number; radius: number } | null {
    let best: { id: string; x: number; y: number; radius: number } | null =
      null;
    let bestDistSq = Infinity;

    for (const [id, glyph] of this.glyphs) {
      if (!glyph.root.visible) {
        continue;
      }
      const pos = this.displayPositions.get(id);
      if (!pos || glyph.sourceChars.length === 0) {
        continue;
      }

      const radius =
        sphereRadiusForWord(glyph.sourceChars.length, glyph.lastFontSize) *
        glyph.morph.radiusScale *
        1.2;
      const dx = worldX - pos.x;
      const dy = worldY - pos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius && distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { id, x: pos.x, y: pos.y, radius };
      }
    }

    return best;
  }

  update(
    nodes: RenderNode[],
    dt: number,
    viewport: WorldBounds | null = null,
    cameraScale = 1,
  ): void {
    const seen = new Set<string>();
    // Soft follow — hides residual layout micro-jitter on letter shells.
    const positionLerp = 1 - Math.exp(-dt * 5);
    let newSphereBudget = RENDER_BUDGET_CONFIG.maxNewSpheresPerFrame;
    const zoomLift = farZoomRestLift(cameraScale);
    // Far-out spheres are tiny on black — raise the rest floor so the field reads.
    const restAlphaFloor = 0.36 + zoomLift * 0.38;
    const heatAlphaGain = 0.62 - zoomLift * 0.18;

    for (const node of nodes) {
      // Wait for contextual embedding before showing the letter-sphere.
      if (!node.embeddingReady) {
        continue;
      }

      let glyph = this.glyphs.get(node.id);
      const morphology = morphologyFromNode(node);
      const morphKey = morphologyKey(morphology);
      const heatHint = activationHeat(node.activation);
      // Pad cull for coronal rays past the letter shell.
      const cullRadius =
        sphereRadiusForWord(node.label.length, node.fontSize) *
        morphology.radiusScale *
        (1.12 + heatHint * 0.28);
      const probe = this.displayPositions.get(node.id) ?? {
        x: node.x,
        y: node.y,
      };
      const inView =
        viewport === null ||
        circleIntersectsBounds(probe.x, probe.y, cullRadius, viewport);

      if (!glyph) {
        // Don't spend construction budget on spheres the camera can't see yet.
        if (!inView || newSphereBudget <= 0) {
          continue;
        }
        newSphereBudget -= 1;

        const root = new Container();
        // Depth via zIndex + one sortChildren — avoids O(n) setChildIndex churn.
        root.sortableChildren = true;
        glyph = {
          root,
          letters: [],
          wisps: [],
          wispEmit: 0,
          wispSerial: 0,
          prevHeat: 0,
          sourceChars: [],
          age: 0,
          spin: spinPhaseFromId(node.id),
          labelKey: "",
          lastFontSize: 0,
          lastMorphKey: "",
          lastTint: -1,
          sortClock: 0,
          morph: morphology,
        };
        this.glyphs.set(node.id, glyph);
        this.container.addChild(glyph.root);
        this.displayPositions.set(node.id, { x: node.x, y: node.y });
      }

      seen.add(node.id);

      glyph.morph = morphology;

      if (glyph.labelKey !== node.label) {
        this.rebuildLetters(glyph, node.label, node.fontSize, morphology);
        glyph.labelKey = node.label;
        glyph.age = 0;
      } else if (
        glyph.lastFontSize !== node.fontSize ||
        glyph.lastMorphKey !== morphKey
      ) {
        // Density changes need a rebuild; stretch/radius can retarget in place.
        const densityChanged =
          glyph.lastMorphKey !== "" &&
          glyph.lastMorphKey.split("|")[4] !== morphKey.split("|")[4];
        if (densityChanged) {
          this.rebuildLetters(glyph, node.label, node.fontSize, morphology);
        } else {
          this.refreshSphereTargets(glyph, node.fontSize, morphology);
        }
      }

      // Keep clocks/positions alive offscreen so re-entry doesn't pop.
      glyph.age += dt;
      if (morphology.spinSpeed > 0) {
        glyph.spin += dt * morphology.spinSpeed;
      }

      const current = this.displayPositions.get(node.id) ?? {
        x: node.x,
        y: node.y,
      };
      current.x += (node.x - current.x) * positionLerp;
      current.y += (node.y - current.y) * positionLerp;
      this.displayPositions.set(node.id, current);
      glyph.root.position.set(current.x, current.y);

      if (!inView) {
        glyph.root.visible = false;
        // Still age wisps offscreen so they don't pile up.
        this.advanceWispsOffscreen(glyph, dt);
        continue;
      }

      glyph.root.visible = true;

      const appear = easeOutCubic(glyph.age / APPEAR_SECONDS);
      const heat = activationHeat(node.activation);
      const tint = activationColorAtZoom(node.activation, cameraScale);
      const tilt = morphology.tilt;
      // Cheap activation bloom — bigger punch at the peak.
      const bloom = 1 + heat * 0.28;
      glyph.root.scale.set(bloom);

      const tintChanged = tint !== glyph.lastTint;
      if (tintChanged) {
        glyph.lastTint = tint;
      }

      this.emitWisps(glyph, node, heat, dt);

      glyph.sortClock += 1;
      // Throttled painter's order; every frame while hot so wisps layer correctly.
      const shouldSort = glyph.sortClock % 3 === 0 || heat > 0.15;

      for (const letter of glyph.letters) {
        // Expand from the sphere center onto shell positions.
        const local = lerpVec3(ORIGIN, letter.sphere, appear);
        const world = rotateX(rotateY(local, glyph.spin), tilt);
        const projected = projectPerspective(world, FOCAL_LENGTH);
        const { particle } = letter;

        letter.text.position.set(projected.x, projected.y);
        letter.text.scale.set(projected.scale);
        if (tintChanged) {
          letter.text.tint = tint;
        }
        // Rest quieter; peak near-full white. Far zoom lifts the rest floor.
        letter.text.alpha = Math.min(
          1,
          appear *
            particle.alphaScale *
            (restAlphaFloor + projected.scale * 0.32 + heat * heatAlphaGain),
        );

        if (shouldSort) {
          letter.text.zIndex = projected.depth;
        }
      }

      this.updateWisps(glyph, heat, appear, tint, tilt, dt, shouldSort);

      if (shouldSort) {
        glyph.root.sortChildren();
      }

      glyph.prevHeat = heat;
    }

    for (const [id, glyph] of this.glyphs) {
      if (!seen.has(id)) {
        this.container.removeChild(glyph.root);
        this.destroyGlyph(glyph);
        this.glyphs.delete(id);
        this.displayPositions.delete(id);
      }
    }
  }

  clear(): void {
    for (const glyph of this.glyphs.values()) {
      this.container.removeChild(glyph.root);
      this.destroyGlyph(glyph);
    }
    this.glyphs.clear();
    this.displayPositions.clear();
  }

  private emitWisps(
    glyph: WordGlyph,
    node: RenderNode,
    heat: number,
    dt: number,
  ): void {
    const cutoff = ACTIVATION_CONFIG.minimumVisibleActivation;
    if (heat < cutoff || glyph.letters.length === 0) {
      glyph.wispEmit = 0;
      return;
    }

    // Heat spike — cast a coronal burst right away.
    const heatRise = heat - glyph.prevHeat;
    if (heatRise > 0.12 && glyph.wisps.length < MAX_STARS_PER_NODE) {
      this.spawnStar(glyph, node, heat);
    }

    glyph.wispEmit += heat * STAR_EMIT_RATE * dt;
    while (glyph.wispEmit >= 1 && glyph.wisps.length < MAX_STARS_PER_NODE) {
      glyph.wispEmit -= 1;
      this.spawnStar(glyph, node, heat);
    }
    if (glyph.wisps.length >= MAX_STARS_PER_NODE) {
      glyph.wispEmit = Math.min(glyph.wispEmit, 0.99);
    }
  }

  private spawnStar(
    glyph: WordGlyph,
    node: RenderNode,
    heat: number,
  ): void {
    if (glyph.wisps.length >= MAX_STARS_PER_NODE || glyph.letters.length === 0) {
      return;
    }

    glyph.wispSerial += 1;
    const seed =
      spinPhaseFromId(node.id) * 1000 + glyph.wispSerial * 17.13;

    const shellR =
      sphereRadiusForWord(glyph.sourceChars.length, node.fontSize) *
      glyph.morph.radiusScale;
    const stretch = glyph.morph.stretch;
    const r0 = shellR * 0.98;
    const r1 = shellR * (1.05 + heat * 0.07 + hash01(seed + 1.2) * 0.03);
    // Subtle coronal drift — enough to feel alive, not a corkscrew.
    const sweep = 0.18 + hash01(seed + 3.4) * 0.22;
    const lifetime =
      STAR_MIN_LIFETIME +
      hash01(seed + 0.6) * (STAR_MAX_LIFETIME - STAR_MIN_LIFETIME);
    const letterSize = Math.max(4, node.fontSize * LETTER_SIZE_SCALE * 0.9);

    // Even shell directions; rotate the lattice each burst so rays reseed.
    const lattice = fibonacciSpherePoints(ARMS_PER_STAR);
    const yaw = glyph.wispSerial * 1.324 + hash01(seed) * Math.PI * 2;
    const arms: WispArm[] = [];

    for (let a = 0; a < ARMS_PER_STAR; a += 1) {
      const raw = lattice[a]!;
      // Match letter-sphere stretch so rays sit on the same ellipsoid.
      const stretched = {
        x: raw.x * stretch.x,
        y: raw.y * stretch.y,
        z: raw.z * stretch.z,
      };
      const outward = normalizeOrZero(rotateY(stretched, yaw));
      if (outward.x === 0 && outward.y === 0 && outward.z === 0) {
        continue;
      }
      const tangent = tangentOnSphere(outward, seed + a * 3.7);

      const beads: WispBead[] = [];
      for (let i = 0; i < BEADS_PER_ARM; i += 1) {
        const charSource =
          glyph.letters[
            Math.floor(hash01(seed + a * 11.3 + i * 4.1) * glyph.letters.length)
          ]!;
        const char = /[a-z0-9\-']/.test(charSource.particle.char.toLowerCase())
          ? charSource.particle.char.toLowerCase()
          : "·";
        const text = new BitmapText({
          text: char,
          style: {
            fontFamily: LETTER_BITMAP_FONT,
            fontSize: letterSize,
          },
        });
        text.anchor.set(0.5);
        text.tint = ACTIVATION_ACTIVE_COLOR;
        text.eventMode = "none";
        text.visible = false;
        glyph.root.addChild(text);
        beads.push({ text, lag: i * ARM_BEAD_LAG });
      }
      arms.push({ beads, outward, tangent });
    }

    if (arms.length === 0) {
      return;
    }

    glyph.wisps.push({
      arms,
      age: 0,
      lifetime,
      sweep,
      r0,
      r1,
    });
  }

  private updateWisps(
    glyph: WordGlyph,
    heat: number,
    appear: number,
    _tint: number,
    tilt: number,
    dt: number,
    shouldSort: boolean,
  ): void {
    const tailLag = (BEADS_PER_ARM - 1) * ARM_BEAD_LAG;

    for (let i = glyph.wisps.length - 1; i >= 0; i -= 1) {
      const star = glyph.wisps[i]!;
      star.age += dt;
      const head = star.age / star.lifetime;
      if (head >= 1 + tailLag) {
        this.destroyStar(glyph, star);
        glyph.wisps.splice(i, 1);
        continue;
      }

      for (const arm of star.arms) {
        for (const bead of arm.beads) {
          const u = head - bead.lag;
          if (u <= 0 || u >= 1) {
            bead.text.visible = false;
            continue;
          }

          bead.text.visible = true;
          // Lift along the shell normal in local 3D; share spin/tilt with letters.
          const pathT = easeOutCubic(u);
          const radius = star.r0 + (star.r1 - star.r0) * pathT;
          const drift = Math.sin(star.sweep * pathT) * radius * 0.1;
          const local: Vec3 = {
            x: arm.outward.x * radius + arm.tangent.x * drift,
            y: arm.outward.y * radius + arm.tangent.y * drift,
            z: arm.outward.z * radius + arm.tangent.z * drift,
          };
          const world = rotateX(rotateY(local, glyph.spin), tilt);
          const projected = projectPerspective(world, FOCAL_LENGTH);

          const cool = Math.pow(u, 0.9);
          bead.text.position.set(projected.x, projected.y);
          bead.text.scale.set(projected.scale * (1.02 - cool * 0.2));
          bead.text.tint = interpolateColor(
            ACTIVATION_ACTIVE_COLOR,
            ACTIVATION_INACTIVE_COLOR,
            cool,
          );
          const alongFade = Math.pow(1 - u, 0.75);
          bead.text.alpha = Math.min(
            1,
            appear *
              alongFade *
              (0.45 + heat * 0.6) *
              (0.55 + projected.scale * 0.4),
          );

          if (shouldSort) {
            bead.text.zIndex = projected.depth;
          }
        }
      }
    }
  }

  private advanceWispsOffscreen(glyph: WordGlyph, dt: number): void {
    const tailLag = (BEADS_PER_ARM - 1) * ARM_BEAD_LAG;
    for (let i = glyph.wisps.length - 1; i >= 0; i -= 1) {
      const star = glyph.wisps[i]!;
      star.age += dt;
      if (star.age / star.lifetime >= 1 + tailLag) {
        this.destroyStar(glyph, star);
        glyph.wisps.splice(i, 1);
      }
    }
  }

  private destroyStar(glyph: WordGlyph, star: WispArc): void {
    for (const arm of star.arms) {
      for (const bead of arm.beads) {
        glyph.root.removeChild(bead.text);
        bead.text.destroy();
      }
    }
  }

  private clearWisps(glyph: WordGlyph): void {
    for (const star of glyph.wisps) {
      this.destroyStar(glyph, star);
    }
    glyph.wisps = [];
    glyph.wispEmit = 0;
  }

  private rebuildLetters(
    glyph: WordGlyph,
    label: string,
    fontSize: number,
    morphology: SphereMorphology,
  ): void {
    this.clearWisps(glyph);
    for (const letter of glyph.letters) {
      glyph.root.removeChild(letter.text);
      letter.text.destroy();
    }
    glyph.letters = [];
    glyph.sourceChars = [...label];

    const particles = buildLayeredLetterParticles(
      label,
      morphology.densityScale,
    );
    const unitCube = cubeSurfacePoints(particles.length);
    const outerRadius =
      sphereRadiusForWord(glyph.sourceChars.length, fontSize) *
      morphology.radiusScale;
    const letterSize = fontSize * LETTER_SIZE_SCALE;
    const stretch = morphology.stretch;

    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i]!;
      // Fallback for rare chars outside the atlas (keeps layout stable).
      const char = /[a-z0-9\-']/.test(particle.char.toLowerCase())
        ? particle.char.toLowerCase()
        : "·";
      const text = new BitmapText({
        text: char,
        style: {
          fontFamily: LETTER_BITMAP_FONT,
          fontSize: Math.max(4, letterSize),
        },
      });
      text.anchor.set(0.5);
      text.tint = ACTIVATION_INACTIVE_COLOR;
      glyph.root.addChild(text);

      const unit = unitCube[i] ?? { x: 0, y: 0, z: 1 };
      const shellRadius = outerRadius * particle.shellScale;

      glyph.letters.push({
        text,
        particle,
        sphere: {
          x: unit.x * shellRadius * stretch.x,
          y: unit.y * shellRadius * stretch.y,
          z: unit.z * shellRadius * stretch.z,
        },
      });
    }

    glyph.lastFontSize = fontSize;
    glyph.lastMorphKey = morphologyKey(morphology);
    glyph.lastTint = -1;
  }

  private refreshSphereTargets(
    glyph: WordGlyph,
    fontSize: number,
    morphology: SphereMorphology,
  ): void {
    const count = glyph.letters.length;
    if (count === 0) {
      return;
    }

    const unitCube = cubeSurfacePoints(count);
    const outerRadius =
      sphereRadiusForWord(glyph.sourceChars.length, fontSize) *
      morphology.radiusScale;
    const stretch = morphology.stretch;

    for (let i = 0; i < count; i += 1) {
      const letter = glyph.letters[i]!;
      const unit = unitCube[i] ?? { x: 0, y: 0, z: 1 };
      const shellRadius = outerRadius * letter.particle.shellScale;

      letter.sphere = {
        x: unit.x * shellRadius * stretch.x,
        y: unit.y * shellRadius * stretch.y,
        z: unit.z * shellRadius * stretch.z,
      };
    }

    glyph.lastFontSize = fontSize;
    glyph.lastMorphKey = morphologyKey(morphology);
  }

  private destroyGlyph(glyph: WordGlyph): void {
    this.clearWisps(glyph);
    for (const letter of glyph.letters) {
      letter.text.destroy();
    }
    glyph.letters = [];
    glyph.root.destroy({ children: true });
  }
}

function morphologyKey(morphology: SphereMorphology): string {
  const q = (value: number) => value.toFixed(2);
  return [
    q(morphology.radiusScale),
    q(morphology.stretch.x),
    q(morphology.stretch.y),
    q(morphology.stretch.z),
    q(morphology.densityScale),
  ].join("|");
}

/** Unit tangent perpendicular to `normal` for a mild coronal sweep. */
function tangentOnSphere(normal: Vec3, seed: number): Vec3 {
  const axis =
    Math.abs(normal.y) < 0.85
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };
  const cx = normal.y * axis.z - normal.z * axis.y;
  const cy = normal.z * axis.x - normal.x * axis.z;
  const cz = normal.x * axis.y - normal.y * axis.x;
  const len = Math.hypot(cx, cy, cz);
  if (len < 1e-6) {
    return { x: 1, y: 0, z: 0 };
  }
  // Flip some arms so sweeps don't all share one handedness.
  const sign = hash01(seed) > 0.5 ? 1 : -1;
  return { x: (cx / len) * sign, y: (cy / len) * sign, z: (cz / len) * sign };
}

function normalizeOrZero(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-6) {
    return { x: 0, y: 0, z: 0 };
  }
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function hash01(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class DebugOverlay {
  readonly container = new Container();
  private graphics = new Graphics();
  private labels = new Container();

  constructor() {
    this.container.addChild(this.graphics);
    this.container.addChild(this.labels);
  }

  update(
    snapshot: GraphSnapshot,
    settings: AlgorithmSettings,
    displayPositions: Map<string, { x: number; y: number }>,
  ): void {
    const anyDebug =
      settings.showEdges ||
      settings.showEdgeWeights ||
      settings.showCommunityBoundaries ||
      settings.showAnchors ||
      settings.showCommunityIds ||
      settings.showActivationValues;

    this.graphics.clear();
    if (this.labels.children.length > 0) {
      this.labels.removeChildren().forEach((child) => child.destroy());
    }

    if (!anyDebug) {
      return;
    }

    const nodePos = (id: string, fallbackX: number, fallbackY: number) =>
      displayPositions.get(id) ?? { x: fallbackX, y: fallbackY };

    if (settings.showEdges) {
      for (const edge of snapshot.edges) {
        const source = snapshot.nodes.find((n) => n.id === edge.sourceId);
        const target = snapshot.nodes.find((n) => n.id === edge.targetId);
        if (!source || !target) {
          continue;
        }
        const a = nodePos(source.id, source.x, source.y);
        const b = nodePos(target.id, target.x, target.y);
        const alpha = 0.15 + edge.combinedWeight * 0.5;
        this.graphics
          .moveTo(a.x, a.y)
          .lineTo(b.x, b.y)
          .stroke({ width: 1, color: 0x6b7280, alpha });

        if (settings.showEdgeWeights) {
          const label = new Text({
            text: edge.combinedWeight.toFixed(2),
            style: {
              fontFamily: '"Space Mono", monospace',
              fontSize: 10,
              fill: 0x9ca3af,
            },
          });
          label.anchor.set(0.5);
          label.position.set((a.x + b.x) / 2, (a.y + b.y) / 2);
          this.labels.addChild(label);
        }
      }
    }

    if (settings.showCommunityBoundaries || settings.showAnchors) {
      for (const community of snapshot.communities) {
        if (settings.showCommunityBoundaries) {
          this.graphics
            .circle(community.anchorX, community.anchorY, community.radius)
            .stroke({ width: 1, color: 0x4b5563, alpha: 0.35 });
        }
        if (settings.showAnchors) {
          this.graphics
            .circle(community.anchorX, community.anchorY, 4)
            .fill({ color: 0xf59e0b, alpha: 0.8 });
        }
        if (settings.showCommunityIds) {
          const label = new Text({
            text: community.id,
            style: {
              fontFamily: '"Space Mono", monospace',
              fontSize: 11,
              fill: 0xd1d5db,
            },
          });
          label.position.set(community.anchorX + 8, community.anchorY - 8);
          this.labels.addChild(label);
        }
      }
    }

    if (settings.showActivationValues) {
      for (const node of snapshot.nodes) {
        if (node.activation <= 0) {
          continue;
        }
        const pos = nodePos(node.id, node.x, node.y);
        const label = new Text({
          text: node.activation.toFixed(2),
          style: {
            fontFamily: '"Space Mono", monospace',
            fontSize: 10,
            fill: 0xe5e7eb,
          },
        });
        label.position.set(pos.x + 8, pos.y - node.fontSize);
        this.labels.addChild(label);
      }
    }
  }

  clear(): void {
    this.graphics.clear();
    this.labels.removeChildren().forEach((child) => child.destroy());
  }
}
