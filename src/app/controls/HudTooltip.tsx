import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  placeAnchoredTooltip,
  type TooltipPlacement,
} from "./tooltip-placement";

type HudTooltipProps = {
  text: string;
  preferredPlacement?: TooltipPlacement;
  className?: string;
  children: ReactNode;
};

/** Hover/focus tooltip that flips and clamps to stay in the viewport. */
export function HudTooltip({
  text,
  preferredPlacement = "below",
  className,
  children,
}: HudTooltipProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const root = anchorRef.current;
    const tip = tipRef.current;
    if (!open || !root || !tip) {
      return;
    }

    // Prefer the interactive control over a taller wrapper (e.g. mic pill).
    const anchor =
      root.querySelector<HTMLElement>("[data-tooltip-anchor]") ??
      root.querySelector<HTMLElement>("button, [role='button']") ??
      root;
    const rect = anchor.getBoundingClientRect();
    placeAnchoredTooltip(
      tip,
      {
        anchorX: rect.left + rect.width / 2,
        anchorTop: rect.top,
        anchorBottom: rect.bottom,
      },
      preferredPlacement,
    );
    tip.dataset.ready = "true";
  }, [open, text, preferredPlacement]);

  return (
    <div
      ref={anchorRef}
      className={className}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      {children}
      {open
        ? createPortal(
            <div ref={tipRef} className="node-detail-tooltip" role="tooltip">
              {text}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
