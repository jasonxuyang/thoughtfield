/** True for phones/tablets — local AI model apps stay desktop-only. */
export function isMobileBlocked(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.matchMedia("(max-width: 720px)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  return narrow || (coarse && noHover);
}
