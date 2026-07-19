import { buildSampleGraph } from "./build-sample-graph";
import { getSampleDefinition, SAMPLE_CATALOG } from "./catalog";
import { reviveSampleGraph } from "./serialize-sample";
import type { SampleGraph, SerializedSampleGraph } from "./types";

const precomputedModules = import.meta.glob<{ default: SerializedSampleGraph }>(
  "./precomputed/*.json",
  { eager: true },
);

const PRECOMPUTED: Record<string, SerializedSampleGraph> = {};
for (const [path, mod] of Object.entries(precomputedModules)) {
  const payload = mod.default;
  if (payload?.id) {
    PRECOMPUTED[payload.id] = payload;
    continue;
  }
  const match = path.match(/\/([^/]+)\.json$/);
  if (match?.[1] && payload) {
    PRECOMPUTED[match[1]] = payload;
  }
}

/**
 * Load a precomputed sample graph. Falls back to a live build when the JSON
 * is missing or stale (e.g. mid-refactor before re-precompute).
 */
export async function loadSampleGraph(
  id: string,
  onProgress?: (progress: number) => void,
): Promise<SampleGraph> {
  const cached = PRECOMPUTED[id];
  if (
    cached &&
    cached.id === id &&
    Array.isArray(cached.nodes) &&
    cached.nodes.length > 0
  ) {
    onProgress?.(1);
    return reviveSampleGraph(cached);
  }

  const definition = getSampleDefinition(id);
  if (!definition) {
    throw new Error(`Unknown sample id: ${id}`);
  }
  return buildSampleGraph(definition, onProgress);
}

/** Every catalog sample, preferring precomputed payloads. */
export async function loadAllSampleGraphs(
  onProgress?: (id: string, progress: number) => void,
): Promise<SampleGraph[]> {
  const graphs: SampleGraph[] = [];
  for (const sample of SAMPLE_CATALOG) {
    graphs.push(
      await loadSampleGraph(sample.id, (progress) =>
        onProgress?.(sample.id, progress),
      ),
    );
  }
  return graphs;
}
