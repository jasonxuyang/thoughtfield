/// <reference lib="webworker" />

import {
  EMBED_BATCH_CONFIG,
  PERSISTENCE_CONFIG,
  type AlgorithmSettings,
} from "../config/algorithms";
import { GraphStore } from "../graph/graph-store";
import type {
  Community,
  WordEdge,
  WordNode,
  WordOccurrence,
} from "../graph/graph-types";
import type { GraphWorkerIn, GraphWorkerOut } from "./worker-messages";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const store = new GraphStore();
let embedRequestCounter = 0;
let lastPersistAt = 0;
let lastSnapshotAt = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function post(message: GraphWorkerOut, transfer?: Transferable[]): void {
  if (transfer) {
    ctx.postMessage(message, transfer);
  } else {
    ctx.postMessage(message);
  }
}

function schedulePersist(): void {
  if (persistTimer) {
    return;
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersist();
  }, PERSISTENCE_CONFIG.saveDebounceMs);
}

function flushPersist(): void {
  const now = Date.now();
  if (now - lastPersistAt < PERSISTENCE_CONFIG.saveDebounceMs / 2) {
    return;
  }
  lastPersistAt = now;
  const payload = store.serializeForPersistence();
  post({ type: "persist", payload });
}

function requestEmbeddings(): void {
  const ready = store.collectReadyContexts(
    Date.now(),
    EMBED_BATCH_CONFIG.maxPerRequest,
  );
  if (ready.length === 0) {
    return;
  }

  embedRequestCounter += 1;
  post({
    type: "embed-request",
    requestId: `embed_${embedRequestCounter}`,
    items: ready.map((item) => ({
      id: item.occurrenceId,
      text: item.contextText,
    })),
  });
}

function emitSnapshot(mode: "tick" | "coalesce" | "immediate" = "tick"): void {
  const now = Date.now();
  // Streaming otherwise floods the main thread with structured-clone snapshots.
  if (mode !== "immediate") {
    const minIntervalMs = mode === "coalesce" ? 48 : 72;
    if (now - lastSnapshotAt < minIntervalMs) {
      return;
    }
  }
  lastSnapshotAt = now;
  post({ type: "snapshot", snapshot: store.toSnapshot() });
}

ctx.onmessage = (event: MessageEvent<GraphWorkerIn>) => {
  const message = event.data;

  switch (message.type) {
    case "init":
      post({ type: "ready" });
      emitSnapshot("immediate");
      break;
    case "committed-words":
      store.ingestCommittedWords(message.words);
      store.maybeRecluster();
      requestEmbeddings();
      // Coalesce with the tick stream — avoids a clone per spoken word.
      emitSnapshot("tick");
      schedulePersist();
      break;
    case "embeddings":
      for (const result of message.results) {
        store.applyEmbedding(result.occurrenceId, result.embedding);
      }
      store.maybeRecluster();
      emitSnapshot("coalesce");
      schedulePersist();
      break;
    case "update-settings":
      store.applySettings(message.settings);
      store.maybeRecluster(Date.now());
      emitSnapshot("immediate");
      schedulePersist();
      break;
    case "activate-node":
      store.activateNode(message.nodeId, {
        updateFocus: message.updateFocus,
      });
      emitSnapshot("immediate");
      break;
    case "set-pinned-node":
      store.setPinnedNode(message.nodeId);
      emitSnapshot("immediate");
      break;
    case "clear":
      store.clear();
      emitSnapshot("immediate");
      flushPersist();
      break;
    case "tick":
      store.tick(message.deltaMs);
      store.maybeRecluster();
      requestEmbeddings();
      emitSnapshot("tick");
      break;
    case "request-snapshot":
      emitSnapshot("immediate");
      break;
    case "hydrate": {
      const payload = message.payload as {
        nodes: WordNode[];
        edges: WordEdge[];
        communities: Community[];
        occurrences?: WordOccurrence[];
        settings?: AlgorithmSettings;
        committedTranscript?: string;
        sequenceIndex?: number;
      };
      store.hydrate(payload);
      emitSnapshot("immediate");
      break;
    }
    default: {
      const _exhaustive: never = message;
      void _exhaustive;
      break;
    }
  }
};
