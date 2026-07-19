/// <reference lib="webworker" />

import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import { MODEL_CONFIG, type ExecutionDevice } from "../config/models";
import { normalizeVector } from "../embeddings/vector-math";
import type { EmbeddingWorkerIn, EmbeddingWorkerOut } from "./worker-messages";

env.allowLocalModels = false;

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

let extractor: FeatureExtractionPipeline | null = null;
let device: ExecutionDevice = MODEL_CONFIG.fallbackDevice;
let queue: Array<{
  requestId: string;
  texts: Array<{ id: string; text: string }>;
}> = [];
let processing = false;

function post(message: EmbeddingWorkerOut, transfer?: Transferable[]): void {
  if (transfer) {
    ctx.postMessage(message, transfer);
  } else {
    ctx.postMessage(message);
  }
}

async function detectDevice(): Promise<ExecutionDevice> {
  try {
    if (
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      MODEL_CONFIG.preferredDevice === "webgpu"
    ) {
      const adapter = await (
        navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }
      ).gpu?.requestAdapter();
      if (adapter) {
        return "webgpu";
      }
    }
  } catch {
    // fall through
  }
  return MODEL_CONFIG.fallbackDevice;
}

async function initModel(): Promise<void> {
  device = await detectDevice();
  post({
    type: "progress",
    progress: {
      model: "embeddings",
      status: "loading",
      progress: 0,
      message: `Loading embeddings (${device})…`,
      device,
    },
  });

  // Transformers.js reports per-file progress that resets; keep a peak so the
  // boot bar never jumps backwards between shards.
  let peakProgress = 0;
  const load = async (selected: ExecutionDevice) => {
    extractor = await pipeline(
      "feature-extraction",
      MODEL_CONFIG.embeddings,
      {
        device: selected,
        dtype: MODEL_CONFIG.embeddingsDtype,
        progress_callback: (progress: {
          status?: string;
          progress?: number;
          file?: string;
        }) => {
          const value =
            typeof progress.progress === "number" ? progress.progress / 100 : 0.1;
          peakProgress = Math.min(0.99, Math.max(peakProgress, value));
          post({
            type: "progress",
            progress: {
              model: "embeddings",
              status: "loading",
              progress: peakProgress,
              message: progress.file
                ? `Downloading ${progress.file}`
                : progress.status ?? "Loading…",
              device: selected,
            },
          });
        },
      },
    );
  };

  try {
    await load(device);
  } catch {
    device = "wasm";
    await load(device);
  }

  post({
    type: "progress",
    progress: {
      model: "embeddings",
      status: "ready",
      progress: 1,
      message: "Embedding model ready",
      device,
    },
  });
}

async function processQueue(): Promise<void> {
  if (processing || !extractor || queue.length === 0) {
    return;
  }

  processing = true;
  const batch = queue.shift()!;

  try {
    const results: Array<{ id: string; embedding: Float32Array }> = [];
    const transfer: Transferable[] = [];

    for (const item of batch.texts) {
      const output = await extractor(item.text, {
        pooling: "mean",
        normalize: true,
      });

      const data = output.data as Float32Array | number[];
      const vector =
        data instanceof Float32Array
          ? normalizeVector(new Float32Array(data))
          : normalizeVector(Float32Array.from(data));

      results.push({ id: item.id, embedding: vector });
      transfer.push(vector.buffer);
    }

    post(
      {
        type: "embeddings",
        requestId: batch.requestId,
        results,
      },
      transfer,
    );
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    processing = false;
    if (queue.length > 0) {
      void processQueue();
    }
  }
}

ctx.onmessage = async (event: MessageEvent<EmbeddingWorkerIn>) => {
  const message = event.data;

  switch (message.type) {
    case "init":
      await initModel();
      break;
    case "embed":
      queue.push({
        requestId: message.requestId,
        texts: message.texts,
      });
      await processQueue();
      break;
    case "reset":
      queue = [];
      break;
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      break;
    }
  }
};
