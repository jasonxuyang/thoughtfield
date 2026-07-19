import { COLOCATION_CONFIG } from "../config/algorithms";

/**
 * Contribution from two words `tokenDistance` apart in sequence
 * (1 = immediate neighbors). Immediate neighbors contribute 1.
 */
export function colocationContribution(
  tokenDistance: number,
  decayTauTokens: number = COLOCATION_CONFIG.decayTauTokens,
): number {
  if (tokenDistance < 1 || decayTauTokens <= 0) {
    return 0;
  }
  return Math.exp(-(tokenDistance - 1) / decayTauTokens);
}

export function normalizeColocationScore(
  colocationRaw: number,
  saturationScale: number = COLOCATION_CONFIG.saturationScale,
): number {
  return 1 - Math.exp(-colocationRaw / saturationScale);
}
