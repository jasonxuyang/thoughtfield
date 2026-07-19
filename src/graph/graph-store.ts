import {
  COMMUNITY_CONFIG,
  CONTEXT_CONFIG,
  DEFAULT_SETTINGS,
  EDGE_CONFIG,
  VIZ_EDGE_CONFIG,
  type AlgorithmSettings,
} from "../config/algorithms";
import { updateEmbeddingMean } from "../embeddings/contextual-centroid";
import {
  AllPairsSemanticIndex,
  filterSemanticNeighbors,
} from "../embeddings/semantic-index";
import { normalizeVector } from "../embeddings/vector-math";
import { decayActivation, propagateActivation } from "./activation";
import {
  computeCombinedWeight,
  makeEdgeId,
  refreshEdgeScores,
  shouldKeepEdge,
} from "./combined-weights";
import { selectRenderEdgesForViz } from "./viz-edges";
import {
  communityRadius,
  computeCommunityCentroid,
} from "./community-affinity";
import { detectCommunities } from "./community-detection";
import { stabilizeCommunities } from "./community-stabilization";
import type {
  CommittedWord,
  Community,
  GraphSnapshot,
  WordEdge,
  WordNode,
  WordOccurrence,
} from "./graph-types";
import {
  placeCommunityAnchorFromGraph,
  stepCommunityLayout,
} from "../layout/community-layout";
import {
  estimateTextBounds,
  fontSizeForOccurrences,
  stepNodeLayout,
} from "../layout/node-layout";
import {
  normalizeColocationScore,
  colocationContribution,
} from "./colocation";

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Date.now().toString(36)}`;
}

/** Stable polar offset from id — keeps siblings from stacking exactly. */
function deterministicOffset(
  id: string,
  radius: number,
): { x: number; y: number } {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) % 10_000) / 10_000 * Math.PI * 2;
  const dist = radius * (0.35 + ((hash >>> 8) % 1000) / 1000 * 0.65);
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
  };
}

function centroidOf(nodes: Array<Pick<WordNode, "x" | "y">>): {
  x: number;
  y: number;
} {
  if (nodes.length === 0) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  for (const node of nodes) {
    x += node.x;
    y += node.y;
  }
  return { x: x / nodes.length, y: y / nodes.length };
}

type PendingContext = {
  occurrenceId: string;
  wordId: string;
  createdAt: number;
  sequenceIndex: number;
};

export class GraphStore {
  nodes = new Map<string, WordNode>();
  nodesByLabel = new Map<string, string>();
  edges = new Map<string, WordEdge>();
  communities = new Map<string, Community>();
  occurrences: WordOccurrence[] = [];
  settings: AlgorithmSettings = { ...DEFAULT_SETTINGS };
  semanticIndex = new AllPairsSemanticIndex();

  committedTranscript = "";
  sequenceIndex = 0;
  dirtyEdgeUpdates = 0;
  lastReclusterAt = 0;
  graphDirty = false;
  /**
   * Latest activated node the home camera may chase. Ingest/embed always
   * pulse activation; this retargets only so the Pixi home camera can follow
   * when the user is not in a custom pan (Pixi ignores it while overriding).
   */
  focusNodeId: string | null = null;
  /** Inspection focus — stays fully activated until cleared. */
  pinnedNodeId: string | null = null;
  private pendingContexts: PendingContext[] = [];
  private meaningfulSequence: string[] = [];

  applySettings(partial: Partial<AlgorithmSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.rebuildCombinedEdges();
    this.graphDirty = true;
  }

  clear(): void {
    this.nodes.clear();
    this.nodesByLabel.clear();
    this.edges.clear();
    this.communities.clear();
    this.occurrences = [];
    this.semanticIndex.clear();
    this.committedTranscript = "";
    this.sequenceIndex = 0;
    this.dirtyEdgeUpdates = 0;
    this.pendingContexts = [];
    this.meaningfulSequence = [];
    this.focusNodeId = null;
    this.pinnedNodeId = null;
    this.graphDirty = true;
  }

  ingestCommittedWords(words: CommittedWord[]): string[] {
    const activatedIds: string[] = [];

    for (const word of words) {
      if (!word.normalizedText) {
        continue;
      }

      const node = this.ensureNode(word);
      node.occurrenceCount += 1;
      node.lastSeenAt = word.endTimeMs;
      node.label = word.normalizedText;

      const bounds = estimateTextBounds(
        node.label,
        fontSizeForOccurrences(node.occurrenceCount),
      );
      node.textWidth = bounds.width;
      node.textHeight = bounds.height;

      const occurrence: WordOccurrence = {
        id: nextId("occ"),
        wordId: node.id,
        rawText: word.rawText,
        normalizedText: word.normalizedText,
        startTimeMs: word.startTimeMs,
        endTimeMs: word.endTimeMs,
        sequenceIndex: this.sequenceIndex,
        embeddingProcessed: false,
      };

      this.occurrences.push(occurrence);
      this.meaningfulSequence.push(node.id);
      this.updateColocationEdges(occurrence);
      propagateActivation(node.id, this.nodes, [...this.edges.values()]);
      activatedIds.push(node.id);

      this.pendingContexts.push({
        occurrenceId: occurrence.id,
        wordId: node.id,
        createdAt: Date.now(),
        sequenceIndex: occurrence.sequenceIndex,
      });

      this.committedTranscript = [
        this.committedTranscript,
        word.rawText,
      ]
        .filter(Boolean)
        .join(" ");

      this.sequenceIndex += 1;
      this.graphDirty = true;
      // Home-camera hint only for nodes already visible. Unplaced words wait
      // until first embed (avoids chasing placeholder coords). Pixi skips the
      // chase while the user has a custom pan.
      if (node.graphPlaced || node.normalizedEmbedding) {
        this.focusNodeId = node.id;
      }
    }

    return activatedIds;
  }

  private ensureNode(word: CommittedWord): WordNode {
    const existingId = this.nodesByLabel.get(word.normalizedText);
    if (existingId) {
      return this.nodes.get(existingId)!;
    }

    const id = nextId("word");
    // Placeholder only — real spawn happens in placeNodeFromGraph on first embed.
    const node: WordNode = {
      id,
      label: word.normalizedText,
      normalizedLabel: word.normalizedText,
      occurrenceCount: 0,
      firstSeenAt: word.startTimeMs,
      lastSeenAt: word.endTimeMs,
      embeddingMean: null,
      normalizedEmbedding: null,
      communityId: null,
      activation: 0,
      activationHoldMs: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      textWidth: 40,
      textHeight: 20,
      graphPlaced: false,
    };

    this.nodes.set(id, node);
    this.nodesByLabel.set(word.normalizedText, id);
    return node;
  }

  private updateColocationEdges(occurrence: WordOccurrence): void {
    const windowTokens = this.settings.colocationWindowTokens;
    const decayTauTokens = this.settings.colocationDecayTauTokens;
    const now = occurrence.endTimeMs;

    for (let i = this.occurrences.length - 2; i >= 0; i -= 1) {
      const prior = this.occurrences[i]!;
      const distance = occurrence.sequenceIndex - prior.sequenceIndex;
      if (distance > windowTokens) {
        break;
      }
      if (distance < 1 || prior.wordId === occurrence.wordId) {
        continue;
      }

      const edgeId = makeEdgeId(prior.wordId, occurrence.wordId);
      let edge = this.edges.get(edgeId);
      if (!edge) {
        edge = {
          id: edgeId,
          sourceId:
            prior.wordId < occurrence.wordId
              ? prior.wordId
              : occurrence.wordId,
          targetId:
            prior.wordId < occurrence.wordId
              ? occurrence.wordId
              : prior.wordId,
          semanticScore: 0,
          colocationRaw: 0,
          colocationScore: 0,
          combinedWeight: 0,
          cooccurrenceCount: 0,
          firstSeenAt: now,
          lastUpdatedAt: now,
        };
        this.edges.set(edgeId, edge);
      }

      edge.colocationRaw += colocationContribution(distance, decayTauTokens);
      edge.cooccurrenceCount += 1;
      edge.lastUpdatedAt = now;
      edge.colocationScore = normalizeColocationScore(edge.colocationRaw);
      edge.combinedWeight = computeCombinedWeight(
        edge.semanticScore,
        edge.colocationScore,
        this.settings.semanticWeight,
        this.settings.colocationWeight,
      );

      this.dirtyEdgeUpdates += 1;
    }
  }

  collectReadyContexts(
    now: number = Date.now(),
    limit: number = Number.POSITIVE_INFINITY,
  ): Array<{
    occurrenceId: string;
    contextText: string;
  }> {
    const ready: Array<{ occurrenceId: string; contextText: string }> = [];
    const remaining: PendingContext[] = [];
    const max = Math.max(0, limit);

    const head = this.pendingContexts[0];
    if (!head) {
      return ready;
    }

    // Don't start occurrence N until 0..N-1 have finished embedding
    // (covers in-flight batches already removed from pendingContexts).
    for (let i = 0; i < head.sequenceIndex; i += 1) {
      if (!this.occurrences[i]?.embeddingProcessed) {
        return ready;
      }
    }

    let blocked = false;
    for (const pending of this.pendingContexts) {
      if (blocked || ready.length >= max) {
        remaining.push(pending);
        continue;
      }

      const futureCount = this.sequenceIndex - pending.sequenceIndex - 1;
      const waitedLongEnough =
        now - pending.createdAt >= CONTEXT_CONFIG.maxWaitForFutureContextMs;

      if (
        futureCount >= CONTEXT_CONFIG.wordsAfter ||
        waitedLongEnough
      ) {
        const contextText = this.buildContextText(pending.sequenceIndex);
        if (contextText) {
          ready.push({
            occurrenceId: pending.occurrenceId,
            contextText,
          });
        } else {
          // Nothing to embed — release the occurrence so render isn't blocked.
          const occurrence = this.occurrences.find(
            (item) => item.id === pending.occurrenceId,
          );
          if (occurrence && !occurrence.embeddingProcessed) {
            occurrence.embeddingProcessed = true;
          }
        }
      } else {
        // Strict FIFO: do not skip past an unready older occurrence.
        blocked = true;
        remaining.push(pending);
      }
    }

    this.pendingContexts = remaining;
    return ready;
  }

  /** Contiguous prefix of occurrences that have finished embedding. */
  embeddedOccurrencePrefix(): number {
    let count = 0;
    for (const occurrence of this.occurrences) {
      if (!occurrence.embeddingProcessed) {
        break;
      }
      count += 1;
    }
    return count;
  }

  private buildContextText(sequenceIndex: number): string {
    const start = Math.max(0, sequenceIndex - CONTEXT_CONFIG.wordsBefore);
    const end = Math.min(
      this.occurrences.length,
      sequenceIndex + CONTEXT_CONFIG.wordsAfter + 1,
    );

    const labels: string[] = [];
    for (let i = start; i < end; i += 1) {
      const occurrence = this.occurrences[i]!;
      labels.push(occurrence.normalizedText);
    }

    return labels.join(" ");
  }

  applyEmbedding(occurrenceId: string, embedding: Float32Array): void {
    const occurrence = this.occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence || occurrence.embeddingProcessed) {
      return;
    }

    occurrence.contextEmbedding = embedding;
    occurrence.embeddingProcessed = true;

    const node = this.nodes.get(occurrence.wordId);
    if (!node) {
      return;
    }

    const priorEmbeddingCount =
      this.occurrences.filter(
        (item) =>
          item.wordId === node.id &&
          item.embeddingProcessed &&
          item.id !== occurrenceId,
      ).length;

    node.embeddingMean = updateEmbeddingMean(
      node.embeddingMean,
      priorEmbeddingCount,
      embedding,
    );
    node.normalizedEmbedding = normalizeVector(node.embeddingMean);
    this.semanticIndex.updateNode(node.id, node.normalizedEmbedding);
    this.recalculateSemanticNeighbors(node.id);

    // First embedding is when the sphere becomes visible — place + pulse now.
    // (Ingest-time activation often decays during context/embed wait.)
    if (priorEmbeddingCount === 0) {
      this.placeNodeFromGraph(node);
      this.focusNodeId = node.id;
      propagateActivation(node.id, this.nodes, [...this.edges.values()]);
    }

    this.graphDirty = true;
  }

  /**
   * Place a node from live graph structure.
   * Uses already-placed nodes only so spawns track the visible cluster.
   */
  private placeNodeFromGraph(node: WordNode): boolean {
    if (node.graphPlaced) {
      return true;
    }

    const placed = [...this.nodes.values()].filter(
      (other) => other.id !== node.id && other.graphPlaced,
    );

    let weightX = 0;
    let weightY = 0;
    let weightSum = 0;

    for (const edge of this.edges.values()) {
      const otherId =
        edge.sourceId === node.id
          ? edge.targetId
          : edge.targetId === node.id
            ? edge.sourceId
            : null;
      if (!otherId || edge.combinedWeight <= 1e-6) {
        continue;
      }

      const other = this.nodes.get(otherId);
      // Only anchor to nodes that already live in the visible layout.
      if (!other?.graphPlaced) {
        continue;
      }

      weightX += other.x * edge.combinedWeight;
      weightY += other.y * edge.combinedWeight;
      weightSum += edge.combinedWeight;
    }

    let anchorX: number;
    let anchorY: number;

    if (weightSum > 1e-6) {
      anchorX = weightX / weightSum;
      anchorY = weightY / weightSum;
    } else if (node.communityId) {
      const members = placed.filter(
        (other) => other.communityId === node.communityId,
      );
      if (members.length > 0) {
        const com = centroidOf(members);
        anchorX = com.x;
        anchorY = com.y;
      } else if (placed.length > 0) {
        const com = centroidOf(placed);
        anchorX = com.x;
        anchorY = com.y;
      } else {
        node.x = 0;
        node.y = 0;
        node.vx = 0;
        node.vy = 0;
        node.graphPlaced = true;
        return true;
      }
    } else if (placed.length > 0) {
      const com = centroidOf(placed);
      anchorX = com.x;
      anchorY = com.y;
    } else {
      // First visible node — seed the field at the origin.
      node.x = 0;
      node.y = 0;
      node.vx = 0;
      node.vy = 0;
      node.graphPlaced = true;
      return true;
    }

    // Ring slot around the anchor so each spawn fans around the cluster
    // instead of stacking on the same side.
    const slot = placed.length;
    const angle = slot * 2.399963;
    const ring = 36 + Math.min(80, slot * 6);
    const jitter = deterministicOffset(node.id, 14);

    node.x = anchorX + Math.cos(angle) * ring + jitter.x;
    node.y = anchorY + Math.sin(angle) * ring + jitter.y;
    node.vx = 0;
    node.vy = 0;
    node.graphPlaced = true;
    return true;
  }

  private recalculateSemanticNeighbors(nodeId: string): void {
    const neighbors = filterSemanticNeighbors(
      this.semanticIndex.getNearestNeighbors(nodeId),
      this.settings.minimumSimilarity,
    );

    for (const neighbor of neighbors) {
      const edgeId = makeEdgeId(nodeId, neighbor.nodeId);
      let edge = this.edges.get(edgeId);
      if (!edge) {
        edge = {
          id: edgeId,
          sourceId: nodeId < neighbor.nodeId ? nodeId : neighbor.nodeId,
          targetId: nodeId < neighbor.nodeId ? neighbor.nodeId : nodeId,
          semanticScore: neighbor.similarity,
          colocationRaw: 0,
          colocationScore: 0,
          combinedWeight: 0,
          cooccurrenceCount: 0,
          firstSeenAt: Date.now(),
          lastUpdatedAt: Date.now(),
        };
        this.edges.set(edgeId, edge);
      } else {
        edge.semanticScore = Math.max(edge.semanticScore, neighbor.similarity);
        edge.lastUpdatedAt = Date.now();
      }

      edge = refreshEdgeScores(
        edge,
        this.settings.semanticWeight,
        this.settings.colocationWeight,
      );
      this.edges.set(edgeId, edge);
      this.dirtyEdgeUpdates += 1;
    }

    this.pruneEdges();
  }

  private rebuildCombinedEdges(): void {
    for (const [id, edge] of this.edges) {
      this.edges.set(
        id,
        refreshEdgeScores(
          edge,
          this.settings.semanticWeight,
          this.settings.colocationWeight,
        ),
      );
    }
    this.pruneEdges();
  }

  private pruneEdges(): void {
    for (const [id, edge] of this.edges) {
      if (
        !shouldKeepEdge(edge, {
          minimumSimilarity: this.settings.minimumSimilarity,
          minimumCombinedWeight: this.settings.minimumCombinedWeight,
          minimumColocationKeep: EDGE_CONFIG.minimumColocationKeep,
        })
      ) {
        this.edges.delete(id);
      }
    }
  }

  maybeRecluster(now: number = Date.now()): void {
    const intervalElapsed =
      now - this.lastReclusterAt >= COMMUNITY_CONFIG.reclusterIntervalMs;
    const enoughUpdates =
      this.dirtyEdgeUpdates >= COMMUNITY_CONFIG.minimumDirtyEdgeUpdates;

    if (!this.graphDirty) {
      return;
    }

    if (!enoughUpdates && !intervalElapsed) {
      return;
    }

    if (this.nodes.size === 0) {
      return;
    }

    this.recluster(now);
  }

  recluster(now: number = Date.now()): void {
    const partitions = detectCommunities(
      [...this.nodes.values()],
      [...this.edges.values()],
      this.settings.louvainResolution,
      COMMUNITY_CONFIG.randomSeed,
    );

    const previous = [...this.communities.values()].map((community) => ({
      id: community.id,
      nodeIds: community.nodeIds,
    }));

    const { communities, retiredIds } = stabilizeCommunities(
      previous,
      partitions,
      COMMUNITY_CONFIG.stableMatchThreshold,
      () => nextId("community"),
    );

    for (const retiredId of retiredIds) {
      this.communities.delete(retiredId);
    }

    for (const node of this.nodes.values()) {
      node.communityId = null;
    }

    for (const stabilized of communities) {
      const existing = this.communities.get(stabilized.id);
      const radius = communityRadius(stabilized.nodeIds.length);

      const community: Community = {
        id: stabilized.id,
        nodeIds: stabilized.nodeIds,
        centroidEmbedding: null,
        activation: existing?.activation ?? 0,
        anchorX: existing?.anchorX ?? 0,
        anchorY: existing?.anchorY ?? 0,
        radius,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      community.centroidEmbedding = computeCommunityCentroid(
        community,
        this.nodes,
      );

      if (!existing) {
        const anchor = placeCommunityAnchorFromGraph({
          community,
          nodes: this.nodes,
          existing: [...this.communities.values()],
          edges: [...this.edges.values()],
        });
        community.anchorX = anchor.x;
        community.anchorY = anchor.y;
      }

      for (const nodeId of stabilized.nodeIds) {
        const node = this.nodes.get(nodeId);
        if (node) {
          node.communityId = community.id;
          // Nodes waiting on first placement finally join a community.
          if (!node.graphPlaced && node.normalizedEmbedding) {
            this.placeNodeFromGraph(node);
          }
        }
      }

      this.communities.set(community.id, community);
    }

    this.dirtyEdgeUpdates = 0;
    this.lastReclusterAt = now;
    // Clear dirty so we do not recluster every interval forever.
    this.graphDirty = false;
  }

  /** Manual / UI activation — same pulse path as spoken ingest. */
  activateNode(
    nodeId: string,
    options: { updateFocus?: boolean } = {},
  ): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }
    if (options.updateFocus !== false) {
      this.focusNodeId = nodeId;
    }
    propagateActivation(nodeId, this.nodes, [...this.edges.values()]);
    return true;
  }

  /**
   * Pin a node for inspection: pulse once, then hold activation at full
   * until cleared. Pass null to release.
   */
  setPinnedNode(nodeId: string | null): boolean {
    if (nodeId === null) {
      this.pinnedNodeId = null;
      // Drop home-camera / minimap focus with the inspection pin.
      this.focusNodeId = null;
      return true;
    }
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }
    this.pinnedNodeId = nodeId;
    this.focusNodeId = nodeId;
    propagateActivation(nodeId, this.nodes, [...this.edges.values()]);
    return true;
  }

  tick(deltaMs: number): void {
    decayActivation(this.nodes.values(), deltaMs);
    this.holdPinnedActivation();

    if (this.communities.size > 0) {
      stepCommunityLayout(
        [...this.communities.values()],
        [...this.edges.values()],
        this.nodes,
        1,
      );
    }

    stepNodeLayout(
      [...this.nodes.values()],
      [...this.edges.values()],
      this.communities,
      1,
    );
  }

  private holdPinnedActivation(): void {
    if (!this.pinnedNodeId) {
      return;
    }
    const pinned = this.nodes.get(this.pinnedNodeId);
    if (!pinned) {
      this.pinnedNodeId = null;
      return;
    }
    pinned.activation = 1;
  }

  toSnapshot(): GraphSnapshot {
    const degree = new Map<string, number>();
    const weightSum = new Map<string, number>();
    const semanticSum = new Map<string, number>();
    const colocationSum = new Map<string, number>();

    for (const edge of this.edges.values()) {
      degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1);
      degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1);
      weightSum.set(
        edge.sourceId,
        (weightSum.get(edge.sourceId) ?? 0) + edge.combinedWeight,
      );
      weightSum.set(
        edge.targetId,
        (weightSum.get(edge.targetId) ?? 0) + edge.combinedWeight,
      );
      semanticSum.set(
        edge.sourceId,
        (semanticSum.get(edge.sourceId) ?? 0) + edge.semanticScore,
      );
      semanticSum.set(
        edge.targetId,
        (semanticSum.get(edge.targetId) ?? 0) + edge.semanticScore,
      );
      colocationSum.set(
        edge.sourceId,
        (colocationSum.get(edge.sourceId) ?? 0) + edge.colocationScore,
      );
      colocationSum.set(
        edge.targetId,
        (colocationSum.get(edge.targetId) ?? 0) + edge.colocationScore,
      );
    }

    const pendingWordIds = new Set(
      this.pendingContexts.map((pending) => pending.wordId),
    );
    const occurrenceStats = new Map<
      string,
      { total: number; processed: number }
    >();
    for (const occurrence of this.occurrences) {
      const stats = occurrenceStats.get(occurrence.wordId) ?? {
        total: 0,
        processed: 0,
      };
      stats.total += 1;
      if (occurrence.embeddingProcessed) {
        stats.processed += 1;
      }
      occurrenceStats.set(occurrence.wordId, stats);
    }

    let layoutEnergy = 0;
    const nodes = [...this.nodes.values()].map((node) => {
      layoutEnergy += node.vx * node.vx + node.vy * node.vy;
      const semantic = semanticSum.get(node.id) ?? 0;
      const colocation = colocationSum.get(node.id) ?? 0;
      const affinityTotal = semantic + colocation;
      const community = node.communityId
        ? this.communities.get(node.communityId)
        : null;
      const stats = occurrenceStats.get(node.id);
      const embeddingsSettled =
        !!stats &&
        stats.total > 0 &&
        stats.processed === stats.total &&
        !pendingWordIds.has(node.id);

      return {
        id: node.id,
        label: node.label,
        x: node.x,
        y: node.y,
        activation: node.activation,
        occurrenceCount: node.occurrenceCount,
        communityId: node.communityId,
        fontSize: fontSizeForOccurrences(node.occurrenceCount),
        degree: degree.get(node.id) ?? 0,
        edgeWeightSum: weightSum.get(node.id) ?? 0,
        semanticRatio:
          affinityTotal > 1e-6 ? semantic / affinityTotal : 0.5,
        communitySize: community?.nodeIds.length ?? 1,
        // Show after first embedding, or once all occurrence work has settled.
        embeddingReady:
          node.normalizedEmbedding !== null || embeddingsSettled,
      };
    });

    const toRenderEdge = (edge: WordEdge) => ({
      id: edge.id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      combinedWeight: edge.combinedWeight,
      semanticScore: edge.semanticScore,
      colocationScore: edge.colocationScore,
    });

    return {
      nodes,
      // Canvas strands: weight-thresholded + soft budget.
      edges: this.selectRenderEdges().map(toRenderEdge),
      // Full adjacency for the detail panel (and anything that needs degree parity).
      graphEdges: [...this.edges.values()].map(toRenderEdge),
      communities: [...this.communities.values()].map((community) => ({
        id: community.id,
        anchorX: community.anchorX,
        anchorY: community.anchorY,
        radius: community.radius,
        nodeIds: [...community.nodeIds],
      })),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      communityCount: this.communities.size,
      committedTranscript: this.committedTranscript,
      timestamp: Date.now(),
      focusNodeId: this.focusNodeId,
      layoutEnergy,
      embeddedOccurrencePrefix: this.embeddedOccurrencePrefix(),
    };
  }

  /**
   * Viz edges only: weight threshold + soft budget (see selectRenderEdgesForViz).
   * Layout/activation/clustering still use the full edge map.
   */
  private selectRenderEdges(): WordEdge[] {
    const candidates = [...this.edges.values()].map((edge) => {
      const sourceAct = this.nodes.get(edge.sourceId)?.activation ?? 0;
      const targetAct = this.nodes.get(edge.targetId)?.activation ?? 0;
      const hot =
        sourceAct >= VIZ_EDGE_CONFIG.activationPriority ||
        targetAct >= VIZ_EDGE_CONFIG.activationPriority;
      return { edge, combinedWeight: edge.combinedWeight, hot };
    });

    return selectRenderEdgesForViz(candidates).map((item) => item.edge);
  }

  serializeForPersistence(): {
    nodes: WordNode[];
    edges: WordEdge[];
    communities: Community[];
    occurrences: WordOccurrence[];
    settings: AlgorithmSettings;
    committedTranscript: string;
    sequenceIndex: number;
  } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      communities: [...this.communities.values()],
      occurrences: this.settings.persistOccurrences ? this.occurrences : [],
      settings: this.settings,
      committedTranscript: this.committedTranscript,
      sequenceIndex: this.sequenceIndex,
    };
  }

  hydrate(data: {
    nodes: WordNode[];
    edges: WordEdge[];
    communities: Community[];
    occurrences?: WordOccurrence[];
    settings?: AlgorithmSettings;
    committedTranscript?: string;
    sequenceIndex?: number;
  }): void {
    this.clear();

    if (data.settings) {
      const settings = data.settings as AlgorithmSettings & {
        temporalWeight?: number;
      };
      const { temporalWeight, ...rest } = settings;
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...rest,
        colocationWeight:
          rest.colocationWeight ??
          temporalWeight ??
          DEFAULT_SETTINGS.colocationWeight,
      };
    }

    for (const node of data.nodes) {
      const restored: WordNode = {
        ...node,
        embeddingMean: node.embeddingMean
          ? new Float32Array(node.embeddingMean)
          : null,
        normalizedEmbedding: node.normalizedEmbedding
          ? new Float32Array(node.normalizedEmbedding)
          : null,
        // Persisted nodes already have layout positions — don't re-snap.
        graphPlaced: node.graphPlaced ?? true,
        activationHoldMs: node.activationHoldMs ?? 0,
      };
      this.nodes.set(restored.id, restored);
      this.nodesByLabel.set(restored.normalizedLabel, restored.id);
      if (restored.normalizedEmbedding) {
        this.semanticIndex.updateNode(restored.id, restored.normalizedEmbedding);
      }
    }

    for (const edge of data.edges) {
      const legacy = edge as WordEdge & {
        temporalRaw?: number;
        temporalScore?: number;
      };
      const {
        temporalRaw: legacyRaw,
        temporalScore: legacyScore,
        ...rest
      } = legacy;
      this.edges.set(edge.id, {
        ...rest,
        colocationRaw: rest.colocationRaw ?? legacyRaw ?? 0,
        colocationScore: rest.colocationScore ?? legacyScore ?? 0,
      });
    }

    for (const community of data.communities) {
      this.communities.set(community.id, {
        ...community,
        centroidEmbedding: community.centroidEmbedding
          ? new Float32Array(community.centroidEmbedding)
          : null,
      });
    }

    this.occurrences = data.occurrences ?? [];
    this.committedTranscript = data.committedTranscript ?? "";
    this.sequenceIndex = data.sequenceIndex ?? this.occurrences.length;
    this.graphDirty = false;
  }
}
