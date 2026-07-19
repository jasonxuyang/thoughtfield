export type TooltipAnchor = {
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
};

export type TooltipPlacement = "above" | "below";

/** Gap between the trigger and the tooltip edge (also used as viewport inset). */
const TOOLTIP_PAD = 14;

/** Prefer `preferred`, flip if needed, then clamp into the viewport. */
export function placeAnchoredTooltip(
  el: HTMLElement,
  anchor: TooltipAnchor,
  preferred: TooltipPlacement = "below",
): void {
  const { offsetWidth: width, offsetHeight: height } = el;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const spaceBelow = viewH - anchor.anchorBottom - TOOLTIP_PAD;
  const spaceAbove = anchor.anchorTop - TOOLTIP_PAD;

  const fitsBelow = spaceBelow >= height + TOOLTIP_PAD;
  const fitsAbove = spaceAbove >= height + TOOLTIP_PAD;

  let placeAbove: boolean;
  if (preferred === "above") {
    placeAbove = fitsAbove || (!fitsBelow && spaceAbove >= spaceBelow);
  } else {
    placeAbove = !fitsBelow && (fitsAbove || spaceAbove > spaceBelow);
  }

  let left = anchor.anchorX - width / 2;
  let top = placeAbove
    ? anchor.anchorTop - height - TOOLTIP_PAD
    : anchor.anchorBottom + TOOLTIP_PAD;

  left = Math.min(viewW - TOOLTIP_PAD - width, Math.max(TOOLTIP_PAD, left));
  top = Math.min(viewH - TOOLTIP_PAD - height, Math.max(TOOLTIP_PAD, top));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
