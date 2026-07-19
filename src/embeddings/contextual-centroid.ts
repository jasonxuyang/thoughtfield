export function updateEmbeddingMean(
  oldMean: Float32Array | null,
  oldCount: number,
  newEmbedding: Float32Array,
): Float32Array {
  if (!oldMean || oldCount === 0) {
    return new Float32Array(newEmbedding);
  }

  const newCount = oldCount + 1;
  const result = new Float32Array(oldMean.length);

  for (let i = 0; i < result.length; i += 1) {
    result[i] =
      oldMean[i]! + (newEmbedding[i]! - oldMean[i]!) / newCount;
  }

  return result;
}
