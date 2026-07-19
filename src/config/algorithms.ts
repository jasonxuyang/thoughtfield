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
  /**
   * Soft target for cold/medium strands shipped to the canvas.
   * Strong and hot edges can exceed this — see alwaysRenderWeight / strongParity.
   */
  softMaxRenderEdges: 120,
  /**
   * Absolute floor: edges at or above this weight always ship
   * (subject only to hardSafetyMaxRenderEdges).
   */
  alwaysRenderWeight: 0.55,
  /**
   * Relative floor vs the heaviest eligible edge. Keeps near-ties with the
   * strongest link even when many edges are dense and strong.
   */
  strongParity: 0.85,
  /** Pathological denseness guard — not a normal trim. */
  hardSafetyMaxRenderEdges: 400,
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
  /** Softer cluster–cluster push — hard spikes read as layout pops. */
  communityRepulsion: 18_000,
  communitySpringStrength: 0.045,
  /** Glide words toward their community (was snappy on recluster). */
  nodeAnchorAttraction: 0.09,
  /** Cross-community bridges should not collapse clusters. */
  nodeBridgeAttraction: 0,
  nodeRepulsion: 900,
  nodeSpringStrength: 0.045,
  /** Springs between different communities are scaled by this. */
  crossCommunitySpringScale: 0.12,
  /** Higher damping = less oscillation after force spikes. */
  damping: 0.9,
  maxVelocity: 7,
  /** Community anchors share the same velocity clamp / damping. */
  communityMaxVelocity: 5,
};

/** Idle field-fit, focus chase, and sticky-pan drift compensation. */
export const CAMERA_FOLLOW = {
  /** Seconds to ease toward focus / fit. */
  smoothTime: 0.45,
  maxSpeed: 720,
  zoomSmoothTime: 0.55,
  /** Zoom when focusing a single node. */
  defaultScale: 1.5,
  /** Pause node-focus chase after pan/zoom/scrub. */
  idleReturnMs: 2_800,
  /** Sticky-pan: 1:1 below this centroid step; ease above it. */
  maxDriftStep: 48,
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
