import { LAYOUT_CONFIG } from "../config/algorithms";

export { LAYOUT_CONFIG };

export function clampVelocity(
  vx: number,
  vy: number,
  maxVelocity: number = LAYOUT_CONFIG.maxVelocity,
): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy);
  if (speed <= maxVelocity || speed === 0) {
    return { vx, vy };
  }
  const scale = maxVelocity / speed;
  return { vx: vx * scale, vy: vy * scale };
}
