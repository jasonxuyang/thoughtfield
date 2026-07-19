export const ASR_CONFIG = {
  sampleRate: 16_000,
  /** Max pending audio window sent to Whisper (HF demo uses 30s). */
  maxBufferMs: 30_000,
  /** Minimum pending audio before starting a generation. */
  minAudioMs: 800,
  maxNewTokens: 64,
  /**
   * Consecutive identical hypotheses required before archiving
   * (realtime-captions LocalAgreement-style commit).
   */
  agreementCount: 3,
  /** Skip near-silent pending windows — Whisper often hallucinates. */
  silenceRms: 0.008,
};

export const CONTEXT_CONFIG = {
  wordsBefore: 6,
  wordsAfter: 6,
  maxWaitForFutureContextMs: 3_000,
};

/** Pace heavy startup / burst work so the UI stays responsive. */
export const INGEST_QUEUE_CONFIG = {
  batchSize: 2,
  intervalMs: 150,
};

/** Max contexts sent to the embedding worker per tick. */
export const EMBED_BATCH_CONFIG = {
  maxPerRequest: 3,
};

/** Max new letter-spheres created on a single animation frame. */
export const RENDER_BUDGET_CONFIG = {
  maxNewSpheresPerFrame: 2,
};

export const SEMANTIC_CONFIG = {
  minimumSimilarity: 0.48,
};

export const COLOCATION_CONFIG = {
  /** How many prior words to consider for co-occurrence. */
  windowTokens: 12,
  /** Token-distance scale for exponential decay (neighbors ≈ 1). */
  decayTauTokens: 4,
  saturationScale: 3,
};

export const EDGE_CONFIG = {
  semanticWeight: 0.5,
  colocationWeight: 0.5,
  minimumCombinedWeight: 0.18,
  minimumColocationKeep: 0.08,
};

/**
 * Worker keeps the full edge set for layout / activation / clustering.
 * Canvas only ships/draws edges that clear a weight threshold (plus a
 * slightly lower bar when an endpoint is activated).
 */
export const VIZ_EDGE_CONFIG = {
  /** Default minimum combined weight to draw a letter strand. */
  minWeight: 0.28,
  /** Activated endpoints may show slightly weaker links. */
  activeMinWeight: 0.2,
  /** Endpoint activation considered "hot" for the active threshold. */
  activationPriority: 0.08,
};

export const COMMUNITY_CONFIG = {
  resolution: 1,
  /** Slightly calmer while speech is streaming in. */
  reclusterIntervalMs: 2_200,
  minimumDirtyEdgeUpdates: 14,
  stableMatchThreshold: 0.3,
  randomSeed: "word-memory",
};

export const LAYOUT_CONFIG = {
  /** Floor for community–community spacing (before affinity stretch). */
  minCommunityDistance: 520,
  communityDistanceRange: 720,
  nodeRadius: 35,
  communityPadding: 180,
  communityBaseRadius: 80,
  communityRadiusScale: 28,
  edgeBaseDistance: 180,
  edgeWeightDistanceScale: 110,
  communityAffinitySemantic: 0.7,
  communityAffinityColocation: 0.3,
  tickIntervalMs: 32,
  communityRepulsion: 28_000,
  communitySpringStrength: 0.06,
  /** Keep words glued to their community anchor. */
  nodeAnchorAttraction: 0.16,
  /** Cross-community bridges should not collapse clusters. */
  nodeBridgeAttraction: 0,
  nodeRepulsion: 1200,
  nodeSpringStrength: 0.06,
  /** Springs between different communities are scaled by this. */
  crossCommunitySpringScale: 0.12,
  damping: 0.85,
  maxVelocity: 12,
};

/**
 * Default viewport: last focused node at `defaultScale`.
 * User pan/zoom is free; after idle, camera eases back home.
 * Position uses SmoothDamp so layout motion and focus switches stay fluid.
 */
export const CAMERA_FOLLOW = {
  /** Approximate time to reach the focus target (seconds). */
  smoothTime: 0.45,
  /** Cap on chase speed so focus teleports don't whip the view. */
  maxSpeed: 720,
  /** Zoom ease time toward defaultScale. */
  zoomSmoothTime: 0.55,
  /** Zoom level for the default (home) viewport — lower = more zoomed out. */
  defaultScale: 1.5,
  /** Ms without pan/zoom before returning to the default viewport. */
  idleReturnMs: 2_800,
};

/**
 * Ambient graph tour when nothing is selected and the user has been idle
 * (no hover, transcript scroll, or camera drag).
 */
export const IDLE_TOUR_CONFIG = {
  /** Quiet time before the tour starts. */
  idleStartMs: 4_000,
  /** Dwell on each node before advancing. */
  stepMs: 1_850,
  /** Extra pause after finishing a full loop. */
  loopPauseMs: 2_600,
};

/** Entry-preview camera: fit all communities, then peek toward the cursor. */
export const OVERVIEW_CAMERA = {
  /** Screen inset when fitting — keep modest so the field isn't tiny. */
  paddingPx: 64,
  /** Extra world margin around letter-spheres (on top of sphere radius). */
  spherePad: 10,
  /** Multiply fit scale after compute (>1 pulls in tighter on the clusters). */
  fitScale: 1.12,
  /** Cap so a compact field can fill more of the viewport. */
  maxScale: 1.45,
  /** Fraction of leftover pan slack the cursor may use (keeps content in frame). */
  slackFactor: 0.55,
  /** Follow layout drift quickly; mouse peek still eases via the same damp. */
  smoothTime: 0.5,
  maxSpeed: 900,
  zoomSmoothTime: 0.55,
};

export const ACTIVATION_CONFIG = {
  propagation: 0.65,
  propagationDepth: 2,
  /** Keep full white briefly before decay starts. */
  peakHoldMs: 350,
  /** Fade rate after the peak hold (half-life). */
  decayHalfLifeMs: 900,
  /** Cut residual glow sooner so rest state reads clean. */
  minimumVisibleActivation: 0.04,
};

export const PERSISTENCE_CONFIG = {
  saveDebounceMs: 2_000,
  persistOccurrences: true,
};

export type AlgorithmSettings = {
  semanticWeight: number;
  colocationWeight: number;
  minimumCombinedWeight: number;
  minimumSimilarity: number;
  colocationWindowTokens: number;
  colocationDecayTauTokens: number;
  louvainResolution: number;
  showEdges: boolean;
  showEdgeWeights: boolean;
  showCommunityBoundaries: boolean;
  showCommunityIds: boolean;
  showAnchors: boolean;
  showActivationValues: boolean;
  persistOccurrences: boolean;
};

export const DEFAULT_SETTINGS: AlgorithmSettings = {
  semanticWeight: EDGE_CONFIG.semanticWeight,
  colocationWeight: EDGE_CONFIG.colocationWeight,
  minimumCombinedWeight: EDGE_CONFIG.minimumCombinedWeight,
  minimumSimilarity: SEMANTIC_CONFIG.minimumSimilarity,
  colocationWindowTokens: COLOCATION_CONFIG.windowTokens,
  colocationDecayTauTokens: COLOCATION_CONFIG.decayTauTokens,
  louvainResolution: COMMUNITY_CONFIG.resolution,
  showEdges: false,
  showEdgeWeights: false,
  showCommunityBoundaries: false,
  showCommunityIds: false,
  showAnchors: false,
  showActivationValues: false,
  persistOccurrences: PERSISTENCE_CONFIG.persistOccurrences,
};
