import { interpolateColor } from "../embeddings/vector-math";

/** Cool rest gray — bright enough to read, still leaves room for the white flash. */
export const ACTIVATION_INACTIVE_COLOR = 0x6a707a;
export const ACTIVATION_ACTIVE_COLOR = 0xffffff;

/**
 * Visual heat from raw activation.
 * Slightly super-linear so the peak punches and the fade drops off cleanly
 * (sqrt used to keep mid-fade looking “on”).
 */
export function activationHeat(activation: number): number {
  const a = Math.min(1, Math.max(0, activation));
  return Math.min(1, Math.pow(a, 1.15));
}

export function activationColor(activation: number): number {
  return interpolateColor(
    ACTIVATION_INACTIVE_COLOR,
    ACTIVATION_ACTIVE_COLOR,
    activationHeat(activation),
  );
}

/** CSS `rgb(...)` twin of `activationColor` for DOM transcript text. */
export function activationColorCss(activation: number): string {
  const hex = activationColor(activation);
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r} ${g} ${b})`;
}
