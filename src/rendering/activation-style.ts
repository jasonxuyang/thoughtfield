import { interpolateColor } from "../embeddings/vector-math";

/** Cool rest gray — bright enough to read, still leaves room for the white flash. */
export const ACTIVATION_INACTIVE_COLOR = 0x7a8492;
/** Rest gray when the camera is fully zoomed out (tiny on-screen spheres). */
export const ACTIVATION_INACTIVE_FAR_COLOR = 0xa8b0bc;
export const ACTIVATION_ACTIVE_COLOR = 0xffffff;

/**
 * 0 near focus zoom (≥ ~1), 1 when pulled fully out (≤ ~0.4).
 * Lifts rest brightness/opacity so the field stays visible at overview scales.
 */
export function farZoomRestLift(cameraScale: number): number {
  const near = 1.05;
  const far = 0.38;
  if (cameraScale >= near) {
    return 0;
  }
  if (cameraScale <= far) {
    return 1;
  }
  return (near - cameraScale) / (near - far);
}

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

/** Rest→active tint, brightened as the camera zooms out. */
export function activationColorAtZoom(
  activation: number,
  cameraScale: number,
): number {
  const lift = farZoomRestLift(cameraScale);
  const rest =
    lift <= 0
      ? ACTIVATION_INACTIVE_COLOR
      : interpolateColor(
          ACTIVATION_INACTIVE_COLOR,
          ACTIVATION_INACTIVE_FAR_COLOR,
          lift,
        );
  return interpolateColor(
    rest,
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
