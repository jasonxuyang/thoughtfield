import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_SETTINGS,
  INGEST_QUEUE_CONFIG,
  type AlgorithmSettings,
} from "../config/algorithms";
import { DemoTranscriptStream } from "../demo/demo-stream";
import {
  createEntryPreviewGraph,
  ENTRY_PREVIEW_CONFIG,
} from "../demo/entry-preview-graph";
import { SAMPLE_CATALOG } from "../demo/samples/catalog";
import { loadSampleGraph } from "../demo/samples/load-sample";
import {
  createDemoSeed,
  transcriptToCommittedWords,
  USE_DEMO_TRANSCRIPT,
} from "../demo/seed-transcript";
import type { CommittedWord, GraphSnapshot } from "../graph/graph-types";
import {
  clearPersistedState,
  loadGraphState,
  saveGraphState,
} from "../persistence/indexed-db";
import { PixiGraphApp } from "../rendering/pixi-app";
import {
  RealtimeAsrSession,
  type RealtimeSessionOutput,
} from "../transcription/realtime-session";
import type {
  EmbeddingWorkerOut,
  GraphWorkerIn,
  GraphWorkerOut,
  ModelLoadProgress,
} from "../workers/worker-messages";
import { CommittedWordIngestQueue } from "./ingest-queue";
import { BootScreen, type FieldLoadProgress } from "./BootScreen";
import {
  CustomCursor,
  type FocusLockTarget,
} from "./controls/CustomCursor";
import { HudTooltip } from "./controls/HudTooltip";
import {
  buildNodeDetail,
  nodeDetailsEqual,
  NodeDetailPanel,
  type NodeDetail,
} from "./status/NodeDetailPanel";
import { TranscriptPanel } from "./status/StatusBar";

import EmbeddingWorker from "../workers/embedding.worker.ts?worker";
import GraphWorker from "../workers/graph.worker.ts?worker";

type PendingTranscriptFlush = {
  committed: string;
  pending: string;
  graphWords: CommittedWord[];
};

export function App() {
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const pixiRef = useRef<PixiGraphApp | null>(null);
  const asrSessionRef = useRef<RealtimeAsrSession | null>(null);
  const embeddingWorkerRef = useRef<Worker | null>(null);
  const graphWorkerRef = useRef<Worker | null>(null);
  const settingsRef = useRef<AlgorithmSettings>({ ...DEFAULT_SETTINGS });
  const transcriptBufferRef = useRef<PendingTranscriptFlush | null>(null);
  const transcriptRafRef = useRef<number | null>(null);
  const ingestQueueRef = useRef<CommittedWordIngestQueue | null>(null);
  const demoStreamRef = useRef<DemoTranscriptStream | null>(null);
  /** Precomputed canvas field behind the entry screen (not persisted). */
  const previewActiveRef = useRef(false);
  const previewFramedRef = useRef(false);
  /** Wait for live layout energy to drop before dismissing the boot screen. */
  const previewAwaitSettleRef = useRef(false);
  const previewHydratedAtRef = useRef(0);
  const previewTourPendingRef = useRef(false);
  /** Only the first entry-field settle gates the boot overlay. */
  const fieldBootPendingRef = useRef(true);
  /** Ignore the empty persist that follows tearing down the entry preview. */
  const suppressNextPersistRef = useRef(false);
  const previewNodeIdsRef = useRef<string[]>([]);
  const previewActivateIndexRef = useRef(0);
  const previewLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /**
   * Shared canvas ↔ transcript follow clock. Pan/zoom or transcript scrub both
   * bump this; home-camera chase and transcript return-to-focus only resume
   * after the same idle window.
   */
  const lastFollowActivityAtRef = useRef(0);
  const listeningRef = useRef(false);

  const [listening, setListening] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [transcription, setTranscription] = useState<ModelLoadProgress | null>(
    null,
  );
  const [embeddings, setEmbeddings] = useState<ModelLoadProgress | null>(null);
  const [committedText, setCommittedText] = useState("");
  const [pendingText, setPendingText] = useState("");
  /** In-progress typed word(s) — visible at the strip edge until space/enter. */
  const [typedPending, setTypedPending] = useState("");
  /**
   * Transcript seeded by paste / sample / restore. ASR updates only append
   * after this — otherwise the first live hypothesis would wipe it.
   */
  const transcriptBaselineRef = useRef("");
  const committedTextRef = useRef("");
  committedTextRef.current = committedText;
  /**
   * Contiguous graph-occurrence prefix that has finished embedding.
   * Transcript tokens reveal in speech order from this count (not by label).
   */
  const [revealedOccurrenceCount, setRevealedOccurrenceCount] = useState(0);
  /** label → node id for transcript hover → same activate-node path as Pixi. */
  const labelToNodeIdRef = useRef<Map<string, string>>(new Map());
  /** node id → label for map hover → scroll transcript to the word. */
  const nodeIdToLabelRef = useRef<Map<string, string>>(new Map());
  /** Imperative brightness sync — avoids React re-renders every graph tick. */
  const transcriptActivationRef = useRef<
    ((activations: ReadonlyMap<string, number>) => void) | null
  >(null);
  /** Map activation → scroll the matching transcript token into view. */
  const transcriptScrollRef = useRef<
    ((
      label: string,
      options?: { lockCursor?: boolean; focus?: boolean },
    ) => void) | null
  >(null);
  const transcriptReleaseCursorLockRef = useRef<(() => void) | null>(null);
  const snapshotRef = useRef<GraphSnapshot | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<NodeDetail | null>(null);
  const [settings, setSettings] = useState<AlgorithmSettings>({
    ...DEFAULT_SETTINGS,
  });
  /** Entry-preview field load/settle — part of the boot gate. */
  const [fieldProgress, setFieldProgress] = useState<FieldLoadProgress>({
    status: "loading",
    progress: 0,
  });

  const modelsReady = transcription?.status === "ready";
  const fieldReady =
    fieldProgress.status === "ready" || fieldProgress.status === "skipped";
  const bootComplete =
    (transcription?.status === "ready" || transcription?.status === "error") &&
    (embeddings?.status === "ready" || embeddings?.status === "error") &&
    fieldReady;

  const postGraph = useCallback((message: GraphWorkerIn) => {
    graphWorkerRef.current?.postMessage(message);
  }, []);

  const activateNode = useEffectEvent(
    (nodeId: string, options?: { updateFocus?: boolean }) => {
      postGraph({
        type: "activate-node",
        nodeId,
        updateFocus: options?.updateFocus,
      });
    },
  );

  /** Canvas / transcript / pointer motion — pauses both follow cameras together. */
  const bumpFollowActivity = useEffectEvent(() => {
    lastFollowActivityAtRef.current = performance.now();
  });

  /** Node / transcript click — resume home chase immediately. */
  const clearFollowActivity = useEffectEvent(() => {
    lastFollowActivityAtRef.current = 0;
  });

  const selectNode = useEffectEvent(
    (
      nodeId: string | null,
      options?: {
        /**
         * When the transcript already chose a specific occurrence (click /
         * arrow keys), don't scroll-to-label — that jumps to the *last*
         * match and fights virtualized index navigation.
         */
        syncTranscript?: boolean;
      },
    ) => {
      selectedNodeIdRef.current = nodeId;
      postGraph({ type: "set-pinned-node", nodeId });
      if (!nodeId) {
        setSelectedDetail(null);
        pixiRef.current?.clearFocus();
        return;
      }
      clearFollowActivity();
      const snap = snapshotRef.current;
      if (!snap) {
        setSelectedDetail(null);
        return;
      }
      setSelectedDetail(buildNodeDetail(snap, nodeId));
      pixiRef.current?.focusNode(nodeId);
      const label = nodeIdToLabelRef.current.get(nodeId);
      if (label && options?.syncTranscript !== false) {
        transcriptScrollRef.current?.(label);
      }
    },
  );

  const selectLabel = useEffectEvent((label: string) => {
    const nodeId = labelToNodeIdRef.current.get(label);
    if (nodeId) {
      // Transcript already scrolled / focused the right occurrence.
      selectNode(nodeId, { syncTranscript: false });
    }
  });

  const flushTranscriptBuffer = useEffectEvent(() => {
    transcriptRafRef.current = null;
    const next = transcriptBufferRef.current;
    if (!next) {
      return;
    }
    transcriptBufferRef.current = null;

    const live = next.committed.trim();
    const baseline = transcriptBaselineRef.current.trim();
    const committed =
      baseline && live ? `${baseline} ${live}` : baseline || live;
    // Keep the ref current for typing fold / listen handoff (don't wait on paint).
    committedTextRef.current = committed;

    startTransition(() => {
      setCommittedText(committed);
      setPendingText(next.pending);
    });

    if (next.graphWords.length > 0) {
      ingestQueueRef.current?.enqueue(next.graphWords);
    }
  });

  const queueTranscriptOutput = useEffectEvent(
    (output: RealtimeSessionOutput) => {
      const previous = transcriptBufferRef.current;
      transcriptBufferRef.current = {
        committed: output.committed,
        pending: output.pending,
        graphWords: previous
          ? [...previous.graphWords, ...output.graphWords]
          : output.graphWords,
      };
      if (transcriptRafRef.current === null) {
        transcriptRafRef.current = requestAnimationFrame(() => {
          flushTranscriptBuffer();
        });
      }
    },
  );

  const clearPreviewTimers = useEffectEvent(() => {
    if (previewLoopTimerRef.current !== null) {
      clearTimeout(previewLoopTimerRef.current);
      previewLoopTimerRef.current = null;
    }
  });

  /** End the entry tour and unlock the canvas; leave the graph in place. */
  const releaseEntryPreviewTour = useEffectEvent(() => {
    previewActiveRef.current = false;
    previewFramedRef.current = false;
    previewAwaitSettleRef.current = false;
    previewTourPendingRef.current = false;
    previewNodeIdsRef.current = [];
    previewActivateIndexRef.current = 0;
    clearPreviewTimers();
    pixiRef.current?.setInteractionEnabled(true);
  });

  const schedulePreviewActivation = useEffectEvent((delayMs: number) => {
    clearPreviewTimers();
    previewLoopTimerRef.current = setTimeout(() => {
      previewLoopTimerRef.current = null;
      if (!previewActiveRef.current) {
        return;
      }
      const ids = previewNodeIdsRef.current;
      if (ids.length === 0) {
        return;
      }
      const index = previewActivateIndexRef.current % ids.length;
      const nodeId = ids[index]!;
      previewActivateIndexRef.current = index + 1;
      postGraph({
        type: "activate-node",
        nodeId,
        updateFocus: false,
      });
      const wrapped = previewActivateIndexRef.current % ids.length === 0;
      schedulePreviewActivation(
        wrapped
          ? ENTRY_PREVIEW_CONFIG.loopPauseMs
          : ENTRY_PREVIEW_CONFIG.activateIntervalMs,
      );
    }, delayMs);
  });

  const markFieldSettled = useEffectEvent(() => {
    previewAwaitSettleRef.current = false;
    fieldBootPendingRef.current = false;
    setFieldProgress({ status: "ready", progress: 1 });
    previewTourPendingRef.current = true;
  });

  const startEntryPreview = useEffectEvent(
    async (prebuilt?: Awaited<ReturnType<typeof createEntryPreviewGraph>>) => {
      if (previewActiveRef.current || USE_DEMO_TRANSCRIPT) {
        return;
      }
      const gateBoot = fieldBootPendingRef.current;
      if (gateBoot) {
        setFieldProgress((current) =>
          current.status !== "loading"
            ? current
            : {
                status: "loading",
                progress: Math.max(current.progress, 0.05),
              },
        );
      }
      const preview =
        prebuilt ??
        (await createEntryPreviewGraph(
          gateBoot
            ? (progress) => {
                // Reserve the last stretch for live canvas settle after hydrate.
                setFieldProgress((current) =>
                  current.status !== "loading"
                    ? current
                    : {
                        status: "loading",
                        progress: Math.max(
                          current.progress,
                          0.05 + progress * 0.7,
                        ),
                      },
                );
              }
            : undefined,
        ));

      previewActiveRef.current = true;
      previewFramedRef.current = false;
      previewAwaitSettleRef.current = gateBoot;
      previewHydratedAtRef.current = performance.now();
      previewTourPendingRef.current = !gateBoot;
      previewNodeIdsRef.current = preview.activationOrder;
      previewActivateIndexRef.current = 0;
      pixiRef.current?.setInteractionEnabled(false);
      if (gateBoot) {
        setFieldProgress((current) =>
          current.status !== "loading"
            ? current
            : {
                status: "loading",
                progress: Math.max(current.progress, 0.78),
              },
        );
      }
      postGraph({
        type: "hydrate",
        payload: {
          nodes: preview.nodes,
          edges: preview.edges,
          communities: preview.communities,
          // No transcript UI on the entry field — skip occurrences so the
          // reveal prefix stays at 0 until the user adopts the sample.
          occurrences: [],
          committedTranscript: preview.committedTranscript,
          sequenceIndex: preview.sequenceIndex,
        },
      });
      if (!gateBoot) {
        // Past initial boot — frame on first snapshot via existing path, tour soon.
        schedulePreviewActivation(ENTRY_PREVIEW_CONFIG.startDelayMs);
        previewTourPendingRef.current = false;
      }
    },
  );

  const stopEntryPreview = useEffectEvent(() => {
    if (!previewActiveRef.current) {
      clearPreviewTimers();
      return;
    }
    // Clear posts a persist of the empty store — don't let that block the
    // next cold start from hydrating a fresh entry preview.
    suppressNextPersistRef.current = true;
    releaseEntryPreviewTour();
    postGraph({ type: "clear" });
    void clearPersistedState();
    setRevealedOccurrenceCount(0);
    selectedNodeIdRef.current = null;
    snapshotRef.current = null;
    setSelectedDetail(null);
  });

  /** Adopt a precomputed sample field as a real, interactive session. */
  const handleTrySample = useEffectEvent(async (sampleId: string) => {
    releaseEntryPreviewTour();
    const preview = await loadSampleGraph(sampleId);
    transcriptBaselineRef.current = preview.transcript;
    typingSessionActiveRef.current = false;
    setCommittedText(preview.transcript);
    setPendingText("");
    setTypedPending("");
    selectedNodeIdRef.current = null;
    setSelectedDetail(null);
    postGraph({
      type: "hydrate",
      payload: {
        nodes: preview.nodes,
        edges: preview.edges,
        communities: preview.communities,
        occurrences: preview.occurrences,
        committedTranscript: preview.transcript,
        sequenceIndex: preview.sequenceIndex,
      },
    });
  });

  const onEmbeddingMessage = useEffectEvent((message: EmbeddingWorkerOut) => {
    switch (message.type) {
      case "progress":
        setEmbeddings(message.progress);
        break;
      case "embeddings":
        postGraph({
          type: "embeddings",
          results: message.results.map((result) => ({
            occurrenceId: result.id,
            embedding: result.embedding,
          })),
        });
        break;
      case "error":
        setEmbeddings({
          model: "embeddings",
          status: "error",
          progress: 0,
          message: message.message,
        });
        break;
      default: {
        const _exhaustive: never = message;
        void _exhaustive;
      }
    }
  });

  const onGraphMessage = useEffectEvent(async (message: GraphWorkerOut) => {
    switch (message.type) {
      case "ready":
        break;
      case "snapshot":
        // Pixi consumes every frame; React only needs counts for chrome.
        pixiRef.current?.setSnapshot(message.snapshot);
        snapshotRef.current = message.snapshot;
        if (
          previewActiveRef.current &&
          !previewFramedRef.current &&
          message.snapshot.nodeCount > 0
        ) {
          // Only mark framed once Pixi is mounted and has real bounds —
          // hydrate can beat async mount and a false success left the camera
          // at the origin with every sphere culled offscreen.
          if (pixiRef.current?.frameContentView()) {
            previewFramedRef.current = true;
          }
        }
        if (
          previewActiveRef.current &&
          previewAwaitSettleRef.current &&
          previewFramedRef.current
        ) {
          const elapsed = performance.now() - previewHydratedAtRef.current;
          const energy = message.snapshot.layoutEnergy;
          // Hold the boot screen until live layout calms and spheres have appeared.
          const settled =
            elapsed >= 750 &&
            (energy < 18 || elapsed >= 3_200);
          setFieldProgress((current) => {
            if (current.status !== "loading") {
              return current;
            }
            const next = Math.min(
              0.98,
              0.78 + Math.min(1, elapsed / 3_200) * 0.2,
            );
            return {
              status: "loading",
              progress: Math.max(current.progress, next),
            };
          });
          if (settled) {
            markFieldSettled();
          }
        }
        // Transcript reveals by embedded occurrence prefix (speech order).
        // Label→id + activation still track embedding-ready spheres for hover.
        const nextIds = new Map<string, string>();
        const nextNodeLabels = new Map<string, string>();
        const nextActivations = new Map<string, number>();
        for (const node of message.snapshot.nodes) {
          if (!node.embeddingReady) {
            continue;
          }
          nextIds.set(node.label, node.id);
          nextNodeLabels.set(node.id, node.label);
          nextActivations.set(node.label, node.activation);
        }
        labelToNodeIdRef.current = nextIds;
        nodeIdToLabelRef.current = nextNodeLabels;
        transcriptActivationRef.current?.(nextActivations);
        const selectedId = selectedNodeIdRef.current;
        if (selectedId) {
          const detail = buildNodeDetail(message.snapshot, selectedId);
          if (!detail) {
            selectedNodeIdRef.current = null;
            setSelectedDetail(null);
          } else {
            setSelectedDetail((previous) =>
              nodeDetailsEqual(previous, detail) ? previous : detail,
            );
          }
        }
        setRevealedOccurrenceCount((previous) => {
          const next = message.snapshot.embeddedOccurrencePrefix;
          if (previous === next) {
            return previous;
          }
          return next;
        });
        break;
      case "embed-request":
        embeddingWorkerRef.current?.postMessage({
          type: "embed",
          requestId: message.requestId,
          texts: message.items,
        });
        break;
      case "persist": {
        // Preview / full demo should not write the canned field to IDB.
        if (
          USE_DEMO_TRANSCRIPT ||
          previewActiveRef.current ||
          suppressNextPersistRef.current
        ) {
          suppressNextPersistRef.current = false;
          break;
        }
        const payload = message.payload as Parameters<typeof saveGraphState>[0];
        // An empty snapshot is not a session — keep IDB clear so entry preview
        // can hydrate on the next visit.
        if (!payload.nodes?.length) {
          await clearPersistedState();
          break;
        }
        await saveGraphState(payload);
        break;
      }
      case "error":
        console.error(message.message);
        break;
      default: {
        const _exhaustive: never = message;
        void _exhaustive;
      }
    }
  });

  useEffect(() => {
    settingsRef.current = settings;
    pixiRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const pixi = new PixiGraphApp();
    pixi.onNodeActivate = (nodeId) => {
      // Hover pulses only — camera + transcript sync happen on click/select.
      activateNode(nodeId, { updateFocus: false });
    };
    pixi.onUserCameraInteract = () => {
      bumpFollowActivity();
    };
    pixi.getFollowActivityAt = () => lastFollowActivityAtRef.current;
    pixi.onNodeSelect = (nodeId) => {
      // Keep the entry overlay uncluttered — pulse only, no detail panel.
      if (previewActiveRef.current) {
        return;
      }
      selectNode(nodeId);
    };
    pixiRef.current = pixi;

    const asrSession = new RealtimeAsrSession({
      onProgress: (progress) => {
        setTranscription(progress);
      },
      onOutput: (output) => {
        queueTranscriptOutput(output);
      },
      onError: (message) => {
        console.error("[asr]", message);
        setTranscription((current) => {
          // Keep a ready model usable after transient generate failures.
          if (current?.status === "ready") {
            return current;
          }
          return {
            model: "transcription",
            status: "error",
            progress: 0,
            message,
          };
        });
      },
    });
    asrSessionRef.current = asrSession;
    asrSession.init();

    const embeddingWorker = new EmbeddingWorker();
    const graphWorker = new GraphWorker();
    embeddingWorkerRef.current = embeddingWorker;
    graphWorkerRef.current = graphWorker;

    embeddingWorker.onmessage = (event: MessageEvent<EmbeddingWorkerOut>) => {
      onEmbeddingMessage(event.data);
    };
    graphWorker.onmessage = (event: MessageEvent<GraphWorkerOut>) => {
      void onGraphMessage(event.data);
    };

    embeddingWorker.postMessage({ type: "init" });
    graphWorker.postMessage({ type: "init" });

    const ingestQueue = new CommittedWordIngestQueue({
      batchSize: INGEST_QUEUE_CONFIG.batchSize,
      intervalMs: INGEST_QUEUE_CONFIG.intervalMs,
      onBatch: (words) => {
        graphWorker.postMessage({ type: "committed-words", words });
      },
    });
    ingestQueueRef.current = ingestQueue;

    // Build the entry field in parallel with model load so it can settle
    // under the boot screen instead of after it.
    const previewBuildPromise = USE_DEMO_TRANSCRIPT
      ? null
      : createEntryPreviewGraph((progress) => {
          setFieldProgress((current) => {
            if (current.status !== "loading") {
              return current;
            }
            return {
              status: "loading",
              progress: Math.max(current.progress, 0.05 + progress * 0.7),
            };
          });
        });

    void (async () => {
      // Pixi mount is async (font atlas) — wait so overview framing can stick.
      await pixi.mount(host);
      if (pixiRef.current !== pixi) {
        return;
      }

      if (USE_DEMO_TRANSCRIPT) {
        fieldBootPendingRef.current = false;
        setFieldProgress({ status: "skipped", progress: 1 });
        await clearPersistedState();
        const demo = createDemoSeed();
        setCommittedText("");
        setPendingText("");

        // Stream the canned transcript like live speech so activation pulses
        // are visible as each word commits.
        const stream = new DemoTranscriptStream({
          words: demo.words,
          onTick: (tick) => {
            setCommittedText(tick.committed);
            setPendingText(tick.pending);
            if (tick.words.length > 0) {
              ingestQueue.enqueue(tick.words);
            }
          },
        });
        demoStreamRef.current = stream;
        stream.start();
        return;
      }

      const state = await loadGraphState();
      const hasSession =
        !!state &&
        Array.isArray(state.nodes) &&
        state.nodes.length > 0 &&
        typeof state.committedTranscript === "string" &&
        state.committedTranscript.trim().length > 0;

      if (hasSession && state) {
        // Discard the parallel preview build — restored session wins.
        void previewBuildPromise;
        fieldBootPendingRef.current = false;
        setFieldProgress({ status: "skipped", progress: 1 });
        if (state.settings) {
          const restored = {
            ...DEFAULT_SETTINGS,
            ...(state.settings as AlgorithmSettings),
          };
          setSettings(restored);
          graphWorker.postMessage({
            type: "update-settings",
            settings: restored,
          });
        }
        setCommittedText(state.committedTranscript ?? "");
        transcriptBaselineRef.current = state.committedTranscript ?? "";
        graphWorker.postMessage({ type: "hydrate", payload: state });
        return;
      }

      if (state && !hasSession) {
        // Stale empty / preview-shaped IDB row — clear and show entry field.
        await clearPersistedState();
      }

      // Empty session — hydrate the pre-settled field, then wait for live calm.
      const preview = previewBuildPromise
        ? await previewBuildPromise
        : await createEntryPreviewGraph();
      if (pixiRef.current !== pixi) {
        return;
      }
      await startEntryPreview(preview);
    })();

    let lastTick = performance.now();
    const tickId = window.setInterval(() => {
      const now = performance.now();
      const deltaMs = now - lastTick;
      lastTick = now;
      graphWorker.postMessage({ type: "tick", deltaMs });
    }, 32);

    return () => {
      window.clearInterval(tickId);
      previewActiveRef.current = false;
      previewNodeIdsRef.current = [];
      if (previewLoopTimerRef.current !== null) {
        clearTimeout(previewLoopTimerRef.current);
        previewLoopTimerRef.current = null;
      }
      demoStreamRef.current?.stop();
      demoStreamRef.current = null;
      ingestQueue.stop();
      ingestQueueRef.current = null;
      if (transcriptRafRef.current !== null) {
        cancelAnimationFrame(transcriptRafRef.current);
        transcriptRafRef.current = null;
      }
      transcriptBufferRef.current = null;
      asrSession.destroy();
      asrSessionRef.current = null;
      embeddingWorker.terminate();
      graphWorker.terminate();
      pixi.destroy();
    };
  }, []);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  // Any pointer motion pauses the shared canvas/transcript follow cameras.
  useEffect(() => {
    const onPointerMove = () => {
      bumpFollowActivity();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [bumpFollowActivity]);

  // Start the entry activation tour only after the boot screen can dismiss —
  // so settle work isn't competing with pulse animations under the overlay.
  useEffect(() => {
    if (!bootComplete || !previewTourPendingRef.current) {
      return;
    }
    if (!previewActiveRef.current) {
      previewTourPendingRef.current = false;
      return;
    }
    previewTourPendingRef.current = false;
    schedulePreviewActivation(ENTRY_PREVIEW_CONFIG.startDelayMs);
  }, [bootComplete, schedulePreviewActivation]);

  const handleStart = async () => {
    // Only tear down the non-interactive entry tour — never wipe a real session.
    if (previewActiveRef.current) {
      stopEntryPreview();
    }
    // Fold any typed draft into the baseline before opening a new ASR window.
    const typed = typedPending.trim();
    if (typed) {
      handleCommitTypedWords(typed);
      setTypedPending("");
    } else {
      transcriptBaselineRef.current = committedTextRef.current.trim();
    }
    typingSessionActiveRef.current = false;
    setTypedPending("");
    try {
      await asrSessionRef.current?.start();
      setListening(true);
      setMediaStream(asrSessionRef.current?.mediaStream ?? null);
    } catch {
      setListening(false);
      setMediaStream(null);
    }
  };

  const handleStop = () => {
    asrSessionRef.current?.stop();
    setListening(false);
    setMediaStream(null);
  };

  const handleClear = async () => {
    handleStop();
    stopEntryPreview();
    ingestQueueRef.current?.clear();
    postGraph({ type: "clear" });
    asrSessionRef.current?.reset();
    embeddingWorkerRef.current?.postMessage({ type: "reset" });
    await clearPersistedState();
    if (transcriptRafRef.current !== null) {
      cancelAnimationFrame(transcriptRafRef.current);
      transcriptRafRef.current = null;
    }
    transcriptBufferRef.current = null;
    transcriptBaselineRef.current = "";
    typingSessionActiveRef.current = false;
    setCommittedText("");
    setPendingText("");
    setTypedPending("");
    setRevealedOccurrenceCount(0);
    selectedNodeIdRef.current = null;
    snapshotRef.current = null;
    setSelectedDetail(null);
    startEntryPreview();
  };

  const handlePasteTranscript = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const words = transcriptToCommittedWords(trimmed);
    if (words.length === 0) {
      return;
    }
    stopEntryPreview();
    const committed = words.map((word) => word.rawText).join(" ");
    transcriptBaselineRef.current = committed;
    setCommittedText(committed);
    setPendingText("");
    setTypedPending("");
    ingestQueueRef.current?.enqueue(words);
  };

  /** True after typing has folded ASR into the baseline (until listen/clear). */
  const typingSessionActiveRef = useRef(false);

  /**
   * Stop recording / entry tour and fold the visible transcript into the ASR
   * baseline so a later listen session appends instead of replaying.
   */
  const prepareForTypedInput = useEffectEvent(() => {
    const needsFold =
      listeningRef.current ||
      previewActiveRef.current ||
      !typingSessionActiveRef.current;
    if (previewActiveRef.current) {
      stopEntryPreview();
    }
    if (listeningRef.current) {
      asrSessionRef.current?.stop();
      setListening(false);
      setMediaStream(null);
    }
    if (needsFold) {
      // stop() queues a transcript flush on rAF — apply it before folding.
      if (transcriptRafRef.current !== null) {
        cancelAnimationFrame(transcriptRafRef.current);
        transcriptRafRef.current = null;
      }
      flushTranscriptBuffer();
      const folded = committedTextRef.current.trim();
      transcriptBaselineRef.current = folded;
      // Drop ASR agreement so the next start() doesn't re-emit old committed text.
      asrSessionRef.current?.reset();
      setPendingText("");
      typingSessionActiveRef.current = true;
    }
  });

  const handleTypedPendingChange = useEffectEvent((text: string) => {
    prepareForTypedInput();
    // Typing into the field should drop any inspection / camera focus.
    if (selectedNodeIdRef.current !== null) {
      selectNode(null);
    }
    setTypedPending(text);
  });

  /** Mic / typing input — leave the graph unfocused for input. */
  const clearNodeFocusForComposer = useEffectEvent(() => {
    selectNode(null);
  });

  /** Commit finished typed/pasted words into the transcript + graph. */
  const handleCommitTypedWords = useEffectEvent((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    prepareForTypedInput();
    const words = transcriptToCommittedWords(trimmed, Date.now(), 160);
    if (words.length === 0) {
      return;
    }
    const piece = words.map((word) => word.rawText).join(" ");
    const previous = committedTextRef.current.trim();
    const next = previous ? `${previous} ${piece}` : piece;
    transcriptBaselineRef.current = next;
    setCommittedText(next);
    ingestQueueRef.current?.enqueue(words);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectNode(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Transcript arrow-nav → custom cursor outline lock. */
  const transcriptFocusLockTargetRef = useRef<
    (() => FocusLockTarget | null) | null
  >(null);
  const getTranscriptFocusLockTarget = useCallback(
    () => transcriptFocusLockTargetRef.current?.() ?? null,
    [],
  );

  return (
    <div className="app-shell">
      <CustomCursor getFocusLockTarget={getTranscriptFocusLockTarget} />
      <BootScreen
        transcription={transcription}
        embeddings={embeddings}
        field={fieldProgress}
        visible={!bootComplete}
      />

      <div className="main-stage">
        <div className="canvas-column">
          {bootComplete && (committedText.trim() || listening) ? (
            <HudTooltip
              text="Restart"
              preferredPlacement="below"
              className="session-restart mic-control"
            >
              <button
                type="button"
                className="mic-transport"
                aria-label="Restart"
                onClick={() => void handleClear()}
              >
                <svg
                  className="mic-transport-icon"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </HudTooltip>
          ) : null}
          <div className="canvas-host" ref={canvasHostRef} />
          {selectedDetail ? (
            <NodeDetailPanel
              detail={selectedDetail}
              onClose={() => selectNode(null)}
              onSelectNeighbor={(nodeId) => selectNode(nodeId)}
            />
          ) : null}
          <TranscriptPanel
            committed={committedText}
            pending={pendingText}
            typedPending={typedPending}
            revealedOccurrenceCount={revealedOccurrenceCount}
            focusedLabel={selectedDetail?.label ?? null}
            listening={listening}
            ready={modelsReady}
            mediaStream={mediaStream}
            onToggleListen={() => {
              selectNode(null);
              if (listening) {
                handleStop();
              } else {
                void handleStart();
              }
            }}
            onPasteTranscript={handlePasteTranscript}
            onTypedPendingChange={handleTypedPendingChange}
            onCommitTypedWords={handleCommitTypedWords}
            onComposerFocus={clearNodeFocusForComposer}
            samples={SAMPLE_CATALOG}
            onTrySample={handleTrySample}
            onActivateLabel={(label) => {
              const nodeId = labelToNodeIdRef.current.get(label);
              if (nodeId) {
                // Transcript hover: pulse only. Click uses onSelectLabel → focus.
                activateNode(nodeId, { updateFocus: false });
              }
            }}
            onSelectLabel={selectLabel}
            onUserScrollActivity={bumpFollowActivity}
            getFollowActivityAt={() => lastFollowActivityAtRef.current}
            isHomeFollowPaused={() =>
              pixiRef.current?.isHomeFollowPaused() ?? false
            }
            onCursorLockRelease={bumpFollowActivity}
            activationSinkRef={transcriptActivationRef}
            scrollToLabelRef={transcriptScrollRef}
            focusLockTargetGetterRef={transcriptFocusLockTargetRef}
            releaseCursorLockRef={transcriptReleaseCursorLockRef}
          />
        </div>
      </div>
    </div>
  );
}
