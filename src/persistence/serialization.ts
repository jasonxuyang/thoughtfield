export function float32ToBase64(values: Float32Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToFloat32(encoded: string): Float32Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

export type SerializedFloat32 = {
  __type: "Float32Array";
  data: string;
};

export function serializeFloat32(
  values: Float32Array | null | undefined,
): SerializedFloat32 | null {
  if (!values) {
    return null;
  }
  return {
    __type: "Float32Array",
    data: float32ToBase64(values),
  };
}

export function deserializeFloat32(
  value: SerializedFloat32 | Float32Array | null | undefined,
): Float32Array | null {
  if (!value) {
    return null;
  }
  if (value instanceof Float32Array) {
    return value;
  }
  if (
    typeof value === "object" &&
    "__type" in value &&
    value.__type === "Float32Array"
  ) {
    return base64ToFloat32(value.data);
  }
  return null;
}

export function serializeGraphPayload(payload: {
  nodes: Array<Record<string, unknown>>;
  edges: unknown[];
  communities: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  settings: unknown;
  committedTranscript: string;
  sequenceIndex: number;
}): unknown {
  return {
    ...payload,
    nodes: payload.nodes.map((node) => ({
      ...node,
      embeddingMean: serializeFloat32(node.embeddingMean as Float32Array | null),
      normalizedEmbedding: serializeFloat32(
        node.normalizedEmbedding as Float32Array | null,
      ),
    })),
    communities: payload.communities.map((community) => ({
      ...community,
      centroidEmbedding: serializeFloat32(
        community.centroidEmbedding as Float32Array | null,
      ),
    })),
    occurrences: payload.occurrences.map((occurrence) => ({
      ...occurrence,
      contextEmbedding: serializeFloat32(
        occurrence.contextEmbedding as Float32Array | null | undefined,
      ),
    })),
  };
}

export function deserializeGraphPayload(payload: unknown): {
  nodes: Array<Record<string, unknown>>;
  edges: unknown[];
  communities: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  settings: unknown;
  committedTranscript: string;
  sequenceIndex: number;
} {
  const data = payload as {
    nodes?: Array<Record<string, unknown>>;
    edges?: Array<Record<string, unknown>>;
    communities?: Array<Record<string, unknown>>;
    occurrences?: Array<Record<string, unknown>>;
    settings?: Record<string, unknown>;
    committedTranscript?: string;
    sequenceIndex?: number;
  };

  return {
    nodes: (data.nodes ?? []).map((node) => ({
      ...node,
      embeddingMean: deserializeFloat32(
        node.embeddingMean as SerializedFloat32 | null,
      ),
      normalizedEmbedding: deserializeFloat32(
        node.normalizedEmbedding as SerializedFloat32 | null,
      ),
    })),
    edges: (data.edges ?? []).map((edge) => migrateEdgeFields(edge)),
    communities: (data.communities ?? []).map((community) => ({
      ...community,
      centroidEmbedding: deserializeFloat32(
        community.centroidEmbedding as SerializedFloat32 | null,
      ),
    })),
    occurrences: (data.occurrences ?? []).map((occurrence) => ({
      ...occurrence,
      contextEmbedding: deserializeFloat32(
        occurrence.contextEmbedding as SerializedFloat32 | null,
      ),
    })),
    settings: migrateSettingsFields(data.settings),
    committedTranscript: data.committedTranscript ?? "",
    sequenceIndex: data.sequenceIndex ?? 0,
  };
}

/** Map legacy temporal* edge fields onto colocation* on read. */
function migrateEdgeFields(
  edge: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...edge };
  if (next.colocationRaw === undefined && next.temporalRaw !== undefined) {
    next.colocationRaw = next.temporalRaw;
  }
  if (next.colocationScore === undefined && next.temporalScore !== undefined) {
    next.colocationScore = next.temporalScore;
  }
  delete next.temporalRaw;
  delete next.temporalScore;
  return next;
}

/** Map legacy temporalWeight onto colocationWeight on read. */
function migrateSettingsFields(
  settings: Record<string, unknown> | undefined,
): unknown {
  if (!settings) {
    return settings;
  }
  const next = { ...settings };
  if (next.colocationWeight === undefined && next.temporalWeight !== undefined) {
    next.colocationWeight = next.temporalWeight;
  }
  delete next.temporalWeight;
  return next;
}
