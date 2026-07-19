/// <reference lib="webworker" />

/**
 * Generate-only Whisper worker, adapted from:
 * - https://github.com/huggingface/transformers.js-examples/tree/main/realtime-whisper-webgpu
 * - https://github.com/nico-martin/realtime-captions
 *
 * The main thread owns MediaRecorder + LocalAgreement. This worker only
 * loads the model and turns a PCM window into a transcript string.
 */

import {
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  env,
  full,
} from "@huggingface/transformers";
import { ASR_CONFIG } from "../config/algorithms";
import { MODEL_CONFIG, type ExecutionDevice } from "../config/models";
import type { AsrWorkerIn, AsrWorkerOut } from "./worker-messages";

env.allowLocalModels = false;

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

type WhisperModel = Awaited<
  ReturnType<typeof WhisperForConditionalGeneration.from_pretrained>
>;
type WhisperTokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type WhisperProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;

let tokenizer: WhisperTokenizer | null = null;
let processor: WhisperProcessor | null = null;
let model: WhisperModel | null = null;
let device: ExecutionDevice = MODEL_CONFIG.fallbackDevice;
let busy = false;

function post(message: AsrWorkerOut): void {
  ctx.postMessage(message);
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

async function loadModel(): Promise<void> {
  device = await detectDevice();
  post({
    type: "progress",
    progress: {
      model: "transcription",
      status: "loading",
      progress: 0,
      message: `Loading Whisper (${device})…`,
      device,
    },
  });

  const progressCallback = (progress: {
    status?: string;
    progress?: number;
    file?: string;
  }) => {
    const value =
      typeof progress.progress === "number" ? progress.progress / 100 : 0.1;
    post({
      type: "progress",
      progress: {
        model: "transcription",
        status: "loading",
        progress: Math.min(0.99, Math.max(0, value)),
        message: progress.file
          ? `Downloading ${progress.file}`
          : progress.status ?? "Loading…",
        device,
      },
    });
  };

  const loadWithDevice = async (selected: ExecutionDevice) => {
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_CONFIG.transcription, {
      progress_callback: progressCallback,
    });
    processor = await AutoProcessor.from_pretrained(MODEL_CONFIG.transcription, {
      progress_callback: progressCallback,
    });
    model = await WhisperForConditionalGeneration.from_pretrained(
      MODEL_CONFIG.transcription,
      {
        device: selected,
        dtype: MODEL_CONFIG.transcriptionDtype,
        progress_callback: progressCallback,
      },
    );

    await model.generate({
      input_features: full([1, 80, 3000], 0.0),
      max_new_tokens: 1,
    });
  };

  try {
    await loadWithDevice(device);
  } catch {
    if (device === "webgpu") {
      device = "wasm";
      await loadWithDevice(device);
    } else {
      throw new Error("Failed to load transcription model");
    }
  }

  post({
    type: "progress",
    progress: {
      model: "transcription",
      status: "ready",
      progress: 1,
      message: "Transcription model ready",
      device,
    },
  });
}

async function generate(requestId: string, audio: Float32Array): Promise<void> {
  if (!model || !tokenizer || !processor) {
    post({
      type: "error",
      requestId,
      message: "Transcription model is not ready",
    });
    return;
  }

  if (busy) {
    post({
      type: "error",
      requestId,
      message: "Transcription already in progress",
    });
    return;
  }

  busy = true;
  try {
    const inputs = await processor(audio);
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: ASR_CONFIG.maxNewTokens,
    });

    const decoded = tokenizer.batch_decode(outputs as never, {
      skip_special_tokens: true,
    });
    const text = String(decoded[0] ?? "").trim();
    post({ type: "complete", requestId, text });
  } catch (error) {
    post({
      type: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    busy = false;
  }
}

ctx.onmessage = async (event: MessageEvent<AsrWorkerIn>) => {
  const message = event.data;

  switch (message.type) {
    case "init":
      try {
        await loadModel();
      } catch (error) {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    case "generate":
      await generate(message.requestId, message.audio);
      break;
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      break;
    }
  }
};
