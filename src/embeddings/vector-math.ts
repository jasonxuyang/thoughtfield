export function normalizeVector(vector: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sumSquares += vector[i]! * vector[i]!;
  }

  const magnitude = Math.sqrt(sumSquares);
  const result = new Float32Array(vector.length);

  if (magnitude === 0) {
    return result;
  }

  for (let i = 0; i < vector.length; i += 1) {
    result[i] = vector[i]! / magnitude;
  }

  return result;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;

  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!;
  }

  return dot;
}

export function semanticSimilarity(a: Float32Array, b: Float32Array): number {
  return Math.max(0, cosineSimilarity(a, b));
}

export function interpolateColor(
  inactiveHex: number,
  activeHex: number,
  t: number,
): number {
  const clamped = Math.min(1, Math.max(0, t));
  const ir = (inactiveHex >> 16) & 0xff;
  const ig = (inactiveHex >> 8) & 0xff;
  const ib = inactiveHex & 0xff;
  const ar = (activeHex >> 16) & 0xff;
  const ag = (activeHex >> 8) & 0xff;
  const ab = activeHex & 0xff;

  const r = Math.round(ir + (ar - ir) * clamped);
  const g = Math.round(ig + (ag - ig) * clamped);
  const b = Math.round(ib + (ab - ib) * clamped);

  return (r << 16) | (g << 8) | b;
}
