export type ExecutionDevice = "webgpu" | "wasm";

export const MODEL_CONFIG = {
  transcription: "onnx-community/whisper-tiny.en",
  embeddings: "Xenova/all-MiniLM-L6-v2",
  preferredDevice: "webgpu" as ExecutionDevice,
  fallbackDevice: "wasm" as ExecutionDevice,
  /**
   * Hybrid quant matching the HF realtime-whisper-webgpu demo:
   * fp32 encoder + q4 decoder for speed/quality on WebGPU.
   */
  transcriptionDtype: {
    encoder_model: "fp32",
    decoder_model_merged: "q4",
  } as const,
  embeddingsDtype: "q8" as const,
};

export type ModelConfig = typeof MODEL_CONFIG;
