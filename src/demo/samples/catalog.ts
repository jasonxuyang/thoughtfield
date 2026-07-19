import { GETTYSBURG_SAMPLE } from "./gettysburg";
import { GOLDEN_SAMPLE } from "./golden";
import { THOUGHTFIELD_SAMPLE } from "./thoughtfield";
import type { SampleDefinition } from "./types";

/** Entry-screen background field (product pitch). */
export const ENTRY_SAMPLE_ID = THOUGHTFIELD_SAMPLE.id;

/** All adoptable example Thoughtfields (order = entry UI order). */
export const SAMPLE_CATALOG: readonly SampleDefinition[] = [
  THOUGHTFIELD_SAMPLE,
  GOLDEN_SAMPLE,
  GETTYSBURG_SAMPLE,
];

export function getSampleDefinition(id: string): SampleDefinition | null {
  return SAMPLE_CATALOG.find((sample) => sample.id === id) ?? null;
}
