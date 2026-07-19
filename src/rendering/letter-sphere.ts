export type Vec3 = { x: number; y: number; z: number };

export type LetterParticle = {
  char: string;
  /** Index into the original word — echoes peel away from this letter. */
  sourceIndex: number;
  /** Multiplier on the word's outer sphere radius. */
  shellScale: number;
  /** Base opacity multiplier before depth shading. */
  alphaScale: number;
};

/** Even point distribution on a unit sphere (Fibonacci lattice). */
export function fibonacciSpherePoints(count: number): Vec3[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [{ x: 0, y: 0, z: 1 }];
  }

  const points: Vec3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    points.push({
      x: Math.cos(theta) * radiusAtY,
      y,
      z: Math.sin(theta) * radiusAtY,
    });
  }

  return points;
}

/**
 * Even-ish points on a unit cube surface. Starts from the fibonacci sphere,
 * then projects onto the L∞ cube (divide by max |axis|) so shells stay nested.
 */
export function cubeSurfacePoints(count: number): Vec3[] {
  return fibonacciSpherePoints(count).map((point) => {
    const max = Math.max(
      Math.abs(point.x),
      Math.abs(point.y),
      Math.abs(point.z),
    );
    if (max < 1e-9) {
      return { x: 0, y: 0, z: 1 };
    }
    return {
      x: point.x / max,
      y: point.y / max,
      z: point.z / max,
    };
  });
}

/**
 * Expand a word into a dense multi-shell letter cloud. Letter size stays
 * uniform — shape comes from repeated glyphs and shell density.
 * `densityScale` (from graph degree/weight) thickens mid/inner shells.
 */
export function buildLayeredLetterParticles(
  label: string,
  densityScale = 1,
): LetterParticle[] {
  const chars = [...label];
  if (chars.length === 0) {
    return [];
  }

  const particles: LetterParticle[] = [];
  const density = Math.min(1.8, Math.max(0.65, densityScale));

  const pushShell = (
    count: number,
    shellScale: number,
    alphaScale: number,
    stride: number,
    offset: number,
  ): void => {
    for (let i = 0; i < count; i += 1) {
      const sourceIndex = (i * stride + offset) % chars.length;
      particles.push({
        char: chars[sourceIndex]!,
        sourceIndex,
        shellScale,
        alphaScale,
      });
    }
  };

  // Outer shell — one of each source letter.
  pushShell(chars.length, 1, 1, 1, 0);

  // Mid / inner shells — denser volume (BitmapText keeps this affordable).
  pushShell(
    Math.round(Math.max(chars.length * 1.5, 9) * density),
    0.7,
    0.72,
    2,
    0,
  );
  pushShell(
    Math.round(Math.max(chars.length * 2.05, 12) * density),
    0.4,
    0.48,
    3,
    1,
  );

  return particles;
}

export type SphereMorphology = {
  /** Multiplier on base sphere radius. */
  radiusScale: number;
  /** Axis stretch after unit-sphere placement (ellipsoid). */
  stretch: Vec3;
  /** Radians per second. */
  spinSpeed: number;
  /** Fixed X tilt. */
  tilt: number;
  /** Mid/inner shell density multiplier. */
  densityScale: number;
};

/**
 * Map graph signals → sphere size/shape. Fully deterministic.
 *
 * - size ← occurrences, degree, activation, community size
 * - elongation ← colocation edges (wider) vs semantic (rounder / deeper)
 * - spin ← activation + connectivity
 */
export function morphologyFromNode(node: {
  occurrenceCount: number;
  activation: number;
  degree: number;
  edgeWeightSum: number;
  semanticRatio: number;
  communitySize: number;
}): SphereMorphology {
  const occ = Math.log1p(node.occurrenceCount);
  const deg = Math.log1p(node.degree);
  const weight = Math.log1p(node.edgeWeightSum);
  const act = Math.min(1, Math.max(0, node.activation));
  const sem = Math.min(1, Math.max(0, node.semanticRatio));
  const community = Math.log1p(Math.max(0, node.communitySize - 1));

  return {
    // Keep activation out of structural scales — those were rebuilding
    // letter meshes every pulse. Activation is applied at render time.
    radiusScale:
      0.72 + occ * 0.14 + deg * 0.12 + weight * 0.06 + community * 0.05,
    stretch: {
      // Colocation hubs stretch sideways (chain / sequence feel).
      x: 0.82 + (1 - sem) * 0.62,
      // Semantic hubs grow a bit taller.
      y: 0.82 + sem * 0.45,
      // Semantic + degree add depth / roundness.
      z: 0.68 + sem * 0.38 + deg * 0.07,
    },
    // Always a base spin; activation and degree speed it up.
    spinSpeed: 0.2 + act * 0.9 + deg * 0.05,
    tilt: 0.3 + act * 0.48 + (1 - sem) * 0.1,
    densityScale: 0.82 + deg * 0.2 + weight * 0.1,
  };
}

/** Stable phase from node id — no Math.random. */
export function spinPhaseFromId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000 * Math.PI * 2;
}

export function rotateY(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos + point.z * sin,
    y: point.y,
    z: -point.x * sin + point.z * cos,
  };
}

export function rotateX(point: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x,
    y: point.y * cos - point.z * sin,
    z: point.y * sin + point.z * cos,
  };
}

export function projectPerspective(
  point: Vec3,
  focalLength: number,
): { x: number; y: number; scale: number; depth: number } {
  const depth = focalLength / (focalLength + point.z);
  return {
    x: point.x * depth,
    y: point.y * depth,
    scale: depth,
    depth: point.z,
  };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/** Outer sphere radius from the source word (not particle count). */
export function sphereRadiusForWord(
  letterCount: number,
  fontSize: number,
): number {
  const n = Math.max(1, letterCount);
  const areaPerLetter = (fontSize * 0.95) ** 2;
  const surfaceRadius = Math.sqrt((n * areaPerLetter) / (4 * Math.PI));
  return Math.max(fontSize * 1.85, surfaceRadius * 2.2);
}
