export type WordNode = {
  id: string;
  label: string;
  normalizedLabel: string;

  occurrenceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;

  /**
   * Arithmetic mean of all contextual occurrence embeddings.
   * Do not normalize this value after every update.
   */
  embeddingMean: Float32Array | null;

  /**
   * Normalized copy of embeddingMean used for cosine similarity.
   */
  normalizedEmbedding: Float32Array | null;

  communityId: string | null;

  activation: number;
  /** Ms remaining before exponential decay may reduce activation. */
  activationHoldMs: number;

  x: number;
  y: number;
  vx: number;
  vy: number;

  textWidth: number;
  textHeight: number;

  /**
   * True once position has been snapped from graph structure
   * (neighbors / community) instead of the invisible placeholder.
   */
  graphPlaced: boolean;
};

export type WordOccurrence = {
  id: string;
  wordId: string;
  rawText: string;
  normalizedText: string;

  startTimeMs: number;
  endTimeMs: number;

  sequenceIndex: number;

  contextText?: string;
  contextEmbedding?: Float32Array;
  embeddingProcessed: boolean;
};

export type WordEdge = {
  id: string;
  sourceId: string;
  targetId: string;

  semanticScore: number;
  colocationRaw: number;
  colocationScore: number;

  combinedWeight: number;

  cooccurrenceCount: number;
  firstSeenAt: number;
  lastUpdatedAt: number;
};

export type Community = {
  id: string;
  nodeIds: string[];

  centroidEmbedding: Float32Array | null;

  activation: number;

  anchorX: number;
  anchorY: number;

  radius: number;

  createdAt: number;
  updatedAt: number;
};

export type RenderNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  activation: number;
  occurrenceCount: number;
  communityId: string | null;
  fontSize: number;
  /** Number of neighboring words via graph edges. */
  degree: number;
  /** Sum of combined edge weights. */
  edgeWeightSum: number;
  /**
   * semantic / (semantic + colocation) across incident edges.
   * 1 = pure semantic hub, 0 = pure colocation chain link.
   */
  semanticRatio: number;
  /** Size of this node's community (1 if unclustered). */
  communitySize: number;
  /** True once at least one contextual embedding has been applied. */
  embeddingReady: boolean;
};

export type RenderEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  combinedWeight: number;
  semanticScore: number;
  colocationScore: number;
};

export type RenderCommunity = {
  id: string;
  anchorX: number;
  anchorY: number;
  radius: number;
  nodeIds: string[];
};

export type GraphSnapshot = {
  nodes: RenderNode[];
  edges: RenderEdge[];
  communities: RenderCommunity[];
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  committedTranscript: string;
  timestamp: number;
  /** Most recently relevant node for camera focus (ingest / first embed). */
  focusNodeId: string | null;
  /** Sum of node vx²+vy² — used to wait for preview layout settle. */
  layoutEnergy: number;
};

export type CommittedWord = {
  rawText: string;
  normalizedText: string;
  startTimeMs: number;
  endTimeMs: number;
  sequenceIndex: number;
};
