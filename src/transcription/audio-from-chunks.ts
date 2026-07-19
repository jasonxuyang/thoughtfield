/**
 * Decode MediaRecorder blobs to mono PCM — same approach as
 * nico-martin/realtime-captions and the HF realtime-whisper-webgpu demo.
 */
export async function getAudioFromChunks(
  chunks: Blob[],
  mimeType: string,
  audioContext: AudioContext,
): Promise<Float32Array> {
  if (chunks.length === 0) {
    return new Float32Array(0);
  }

  const blob = new Blob(chunks, { type: mimeType });
  const arrayBuffer = await blob.arrayBuffer();
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  return decoded.getChannelData(0);
}
