/**
 * Build settled sample graphs to JSON for instant hydrate at runtime.
 *
 *   npm run precompute:samples
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSampleGraph } from "../src/demo/samples/build-sample-graph";
import { SAMPLE_CATALOG } from "../src/demo/samples/catalog";
import { serializeSampleGraph } from "../src/demo/samples/serialize-sample";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../src/demo/samples/precomputed");

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });

  for (const definition of SAMPLE_CATALOG) {
    process.stdout.write(`precompute ${definition.id}… `);
    const graph = await buildSampleGraph(definition, (progress) => {
      if (progress >= 1) {
        return;
      }
    });
    const payload = serializeSampleGraph(graph);
    const outPath = path.join(outDir, `${definition.id}.json`);
    await writeFile(outPath, `${JSON.stringify(payload)}\n`, "utf8");
    console.log(
      `${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.occurrences.length} occurrences → ${path.relative(process.cwd(), outPath)}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
