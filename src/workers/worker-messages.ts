import type { AlgorithmSettings } from "../config/algorithms";
import type { CommittedWord, GraphSnapshot } from "../graph/graph-types";
import type { ExecutionDevice } from "../config/models";

export type ModelLoadProgress = {
  model: "transcription" | "embeddings";
  status: "loading" | "ready" | "error";
  progress: number;
  message?: string;
  device?: ExecutionDevice;
};

/**
 * ASR worker protocol modeled on HF realtime-whisper-webgpu /
 * nico-martin/realtime-captions: load once, then generate(audio) → text.
 */
export type AsrWorkerIn =
  | { type: "init" }
  | {
      type: "generate";
      requestId: string;
      audio: Float32Array;
    };

export type AsrWorkerOut =
  | { type: "progress"; progress: ModelLoadProgress }
  | {
      type: "complete";
      requestId: string;
      text: string;
    }
  | { type: "error"; message: string; requestId?: string };

export type EmbeddingWorkerIn =
  | { type: "init" }
  | { type: "embed"; requestId: string; texts: Array<{ id: string; text: string }> }
  | { type: "reset" };

export type EmbeddingWorkerOut =
  | { type: "progress"; progress: ModelLoadProgress }
  | {
      type: "embeddings";
      requestId: string;
      results: Array<{ id: string; embedding: Float32Array }>;
    }
  | { type: "error"; message: string };

export type GraphWorkerIn =
  | { type: "init" }
  | { type: "committed-words"; words: CommittedWord[] }
  | {
      type: "embeddings";
      results: Array<{ occurrenceId: string; embedding: Float32Array }>;
    }
  | { type: "update-settings"; settings: Partial<AlgorithmSettings> }
  | { type: "activate-node"; nodeId: string; updateFocus?: boolean }
  /** Hold a node fully activated (inspection focus); null clears the pin. */
  | { type: "set-pinned-node"; nodeId: string | null }
  | { type: "clear" }
  | { type: "tick"; deltaMs: number }
  | { type: "request-snapshot" }
  | {
      type: "hydrate";
      payload: unknown;
    };

export type GraphWorkerOut =
  | { type: "ready" }
  | { type: "snapshot"; snapshot: GraphSnapshot }
  | {
      type: "embed-request";
      requestId: string;
      items: Array<{ id: string; text: string }>;
    }
  | { type: "persist"; payload: unknown }
  | { type: "error"; message: string };
