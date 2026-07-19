import type {
  Community,
  WordEdge,
  WordNode,
  WordOccurrence,
} from "../../graph/graph-types";
import type { SampleGraph, SerializedSampleGraph } from "./types";

function reviveFloat32(value: unknown): Float32Array | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Float32Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Float32Array(value as number[]);
  }
  if (ArrayBuffer.isView(value) && "length" in value) {
    return new Float32Array(value as unknown as ArrayLike<number>);
  }
  return null;
}

function serializeFloat32(value: Float32Array | null | undefined): number[] | null {
  if (!value) {
    return null;
  }
  return Array.from(value);
}

export function serializeSampleGraph(graph: SampleGraph): SerializedSampleGraph {
  return {
    id: graph.id,
    transcript: graph.transcript,
    sequenceIndex: graph.sequenceIndex,
    activationOrder: graph.activationOrder,
    nodes: graph.nodes.map((node) => ({
      ...node,
      embeddingMean: serializeFloat32(node.embeddingMean),
      normalizedEmbedding: serializeFloat32(node.normalizedEmbedding),
    })),
    edges: graph.edges,
    communities: graph.communities.map((community) => ({
      ...community,
      centroidEmbedding: serializeFloat32(community.centroidEmbedding),
    })),
    occurrences: graph.occurrences.map((occurrence) => ({
      ...occurrence,
      contextEmbedding: serializeFloat32(occurrence.contextEmbedding),
    })),
  };
}

export function reviveSampleGraph(data: SerializedSampleGraph): SampleGraph {
  return {
    id: data.id,
    transcript: data.transcript,
    sequenceIndex: data.sequenceIndex,
    activationOrder: data.activationOrder,
    nodes: (data.nodes as WordNode[]).map((node) => ({
      ...node,
      embeddingMean: reviveFloat32(node.embeddingMean),
      normalizedEmbedding: reviveFloat32(node.normalizedEmbedding),
    })),
    edges: data.edges as WordEdge[],
    communities: (data.communities as Community[]).map((community) => ({
      ...community,
      centroidEmbedding: reviveFloat32(community.centroidEmbedding),
    })),
    occurrences: (data.occurrences as WordOccurrence[]).map((occurrence) => ({
      ...occurrence,
      contextEmbedding:
        reviveFloat32(occurrence.contextEmbedding) ?? undefined,
    })),
  };
}
