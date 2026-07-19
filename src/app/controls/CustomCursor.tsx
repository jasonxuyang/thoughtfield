import {
  useEffect,
  useEffectEvent,
  useRef,
  type MutableRefObject,
} from "react";

export type NodeCursorTarget = {
  id: string;
  x: number;
  y: number;
  radius: number;
};

/** Outline box for keyboard / tour focus lock (screen coordinates). */
export type FocusLockTarget = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  /** Stable id for the focused occurrence — changes trigger a cursor snap. */
  key: string | number;
};

type CustomCursorProps = {
  queryNodeTarget: (
    clientX: number,
    clientY: number,
  ) => NodeCursorTarget | null;
  /**
   * Optional keyboard/tour focus lock. While this returns a target, the cursor
   * outlines that box even if the pointer is elsewhere (or the DOM node is
   * briefly unmounted by virtualization).
   */
  getFocusLockTarget?: () => FocusLockTarget | null;
  /**
   * When true, force-hide the cursor. Cleared on the next pointermove
   * (idle tour, etc.).
   */
  suppressedRef?: MutableRefObject<boolean>;
  /** Fired once when a suppressed cursor is revealed by pointer movement. */
  onSuppressedReveal?: () => void;
};

type CursorMode = "default" | "button" | "node" | "help" | "hidden";

type VisualState = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

const DEFAULT_RING = 28;
const DEFAULT_RADIUS = DEFAULT_RING / 2;
/** Gap between the control edge and the hover outline. */
const BUTTON_PAD = 9;
/** Extra slack past the button edge before the sticky outline lets go. */
const BUTTON_STICK_PAD = 18;
const NODE_PAD = 10;
/** Inner dot tracks the pointer tightly. */
const LERP_DOT = 34;
/** Outer ring trails behind (higher = snappier). */
const LERP_RING = 16;
/** Size/radius morph speed (between ring and dot). */
const LERP_SIZE = 14;

function parseCornerRadius(
  style: CSSStyleDeclaration,
  width: number,
  height: number,
): number {
  const raw = style.borderTopLeftRadius.trim();
  if (!raw) {
    return 0;
  }
  if (raw.endsWith("%")) {
    return (parseFloat(raw) / 100) * Math.min(width, height);
  }
  const px = parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

function isTextEditingTarget(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  return !!el.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
  );
}

function findButtonTarget(el: Element | null): HTMLElement | null {
  if (!el) {
    return null;
  }
  const hit = el.closest(
    'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], .transcript-word.is-interactive, .transcript-word.is-revealing, .node-detail-tag',
  );
  return hit instanceof HTMLElement ? hit : null;
}

function findHelpTarget(el: Element | null): HTMLElement | null {
  if (!el) {
    return null;
  }
  const hit = el.closest(
    '[data-cursor="help"], .node-detail-tip-label, [role="tooltip"]',
  );
  return hit instanceof HTMLElement ? hit : null;
}

/** Tooltips are pointer-events:none — still treat their box as a help target. */
function tooltipContainsPoint(clientX: number, clientY: number): boolean {
  const tips = document.querySelectorAll<HTMLElement>(
    '.node-detail-tooltip[data-ready="true"]',
  );
  for (const tip of tips) {
    const rect = tip.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return true;
    }
  }
  return false;
}

function pointInExpandedRect(
  x: number,
  y: number,
  rect: DOMRect,
  pad: number,
): boolean {
  return (
    x >= rect.left - pad &&
    x <= rect.right + pad &&
    y >= rect.top - pad &&
    y <= rect.bottom + pad
  );
}

function buttonTargetState(button: HTMLElement): VisualState {
  const rect = button.getBoundingClientRect();
  const style = getComputedStyle(button);
  const corner = parseCornerRadius(style, rect.width, rect.height);
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width + BUTTON_PAD * 2,
    height: rect.height + BUTTON_PAD * 2,
    radius: corner + BUTTON_PAD,
  };
}

function easeToward(current: number, target: number, rate: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

export function CustomCursor({
  queryNodeTarget,
  getFocusLockTarget,
  suppressedRef,
  onSuppressedReveal,
}: CustomCursorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const getFocusLockTargetRef = useRef(getFocusLockTarget);
  getFocusLockTargetRef.current = getFocusLockTarget;
  const suppressedRefRef = useRef(suppressedRef);
  suppressedRefRef.current = suppressedRef;
  const onSuppressedRevealRef = useRef(onSuppressedReveal);
  onSuppressedRevealRef.current = onSuppressedReveal;

  const pointerRef = useRef({ x: 0, y: 0, inside: false, pressed: false });
  const modeRef = useRef<CursorMode>("hidden");
  const stickyButtonRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<VisualState>({
    x: 0,
    y: 0,
    width: DEFAULT_RING,
    height: DEFAULT_RING,
    radius: DEFAULT_RADIUS,
  });
  /** Fast layer — drives the center dot. */
  const dotVisualRef = useRef({ x: 0, y: 0 });
  /** Slow layer — drives the trailing outline. */
  const ringVisualRef = useRef<VisualState>({
    x: 0,
    y: 0,
    width: DEFAULT_RING,
    height: DEFAULT_RING,
    radius: DEFAULT_RADIUS,
  });
  const enabledRef = useRef(false);
  const hasPointerSampleRef = useRef(false);
  /** Last focus-lock key — when it changes, snap the cursor to the new word. */
  const focusLockKeyRef = useRef<string | number | null>(null);

  const resolveTarget = useEffectEvent((clientX: number, clientY: number) => {
    if (!enabledRef.current) {
      modeRef.current = "hidden";
      stickyButtonRef.current = null;
      focusLockKeyRef.current = null;
      return;
    }

    if (suppressedRefRef.current?.current) {
      modeRef.current = "hidden";
      stickyButtonRef.current = null;
      focusLockKeyRef.current = null;
      return;
    }

    // Keyboard / tour focus lock — move the cursor onto that word even if the
    // pointer is elsewhere. Cleared by the provider on real pointer movement.
    const focusLock = getFocusLockTargetRef.current?.() ?? null;
    if (focusLock) {
      stickyButtonRef.current = null;
      modeRef.current = "button";
      const nextTarget = {
        x: focusLock.x,
        y: focusLock.y,
        width: focusLock.width,
        height: focusLock.height,
        radius: focusLock.radius,
      };
      targetRef.current = nextTarget;
      // Literally relocate the cursor when the focused word changes.
      if (focusLockKeyRef.current !== focusLock.key) {
        focusLockKeyRef.current = focusLock.key;
        dotVisualRef.current.x = nextTarget.x;
        dotVisualRef.current.y = nextTarget.y;
        ringVisualRef.current.x = nextTarget.x;
        ringVisualRef.current.y = nextTarget.y;
        ringVisualRef.current.width = nextTarget.width;
        ringVisualRef.current.height = nextTarget.height;
        ringVisualRef.current.radius = nextTarget.radius;
        hasPointerSampleRef.current = true;
      }
      return;
    }
    focusLockKeyRef.current = null;

    if (!pointerRef.current.inside) {
      modeRef.current = "hidden";
      stickyButtonRef.current = null;
      return;
    }

    const el = document.elementFromPoint(clientX, clientY);
    if (isTextEditingTarget(el)) {
      modeRef.current = "hidden";
      stickyButtonRef.current = null;
      return;
    }

    if (findHelpTarget(el) || tooltipContainsPoint(clientX, clientY)) {
      stickyButtonRef.current = null;
      modeRef.current = "help";
      targetRef.current = {
        x: clientX,
        y: clientY,
        width: DEFAULT_RING,
        height: DEFAULT_RING,
        radius: DEFAULT_RADIUS,
      };
      return;
    }

    // Gravity: keep the last button until the pointer leaves a padded zone.
    const sticky = stickyButtonRef.current;
    if (sticky && document.contains(sticky) && !sticky.matches(":disabled")) {
      const stickyRect = sticky.getBoundingClientRect();
      if (pointInExpandedRect(clientX, clientY, stickyRect, BUTTON_STICK_PAD)) {
        modeRef.current = "button";
        targetRef.current = buttonTargetState(sticky);
        return;
      }
    }

    const button = findButtonTarget(el);
    if (button) {
      stickyButtonRef.current = button;
      modeRef.current = "button";
      targetRef.current = buttonTargetState(button);
      return;
    }

    stickyButtonRef.current = null;

    const overCanvas =
      el instanceof HTMLCanvasElement || !!el?.closest(".canvas-host");
    if (overCanvas) {
      const node = queryNodeTarget(clientX, clientY);
      if (node) {
        const nextRadius = Math.max(18, node.radius + NODE_PAD);
        modeRef.current = "node";
        targetRef.current = {
          x: node.x,
          y: node.y,
          width: nextRadius * 2,
          height: nextRadius * 2,
          radius: nextRadius,
        };
        return;
      }
    }

    modeRef.current = "default";
    targetRef.current = {
      x: clientX,
      y: clientY,
      width: DEFAULT_RING,
      height: DEFAULT_RING,
      radius: DEFAULT_RADIUS,
    };
  });

  useEffect(() => {
    const root = rootRef.current;
    const ring = ringRef.current;
    const dot = dotRef.current;
    const help = helpRef.current;
    if (!root || !ring || !dot || !help) {
      return;
    }

    const fineQuery = window.matchMedia("(pointer: fine)");
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncEnabled = () => {
      enabledRef.current = fineQuery.matches;
      if (!enabledRef.current) {
        modeRef.current = "hidden";
        root.dataset.mode = "hidden";
        document.documentElement.classList.remove("has-custom-cursor");
      } else {
        document.documentElement.classList.add("has-custom-cursor");
      }
    };
    syncEnabled();

    let raf = 0;
    let lastTime = performance.now();

    const paint = () => {
      raf = requestAnimationFrame(paint);
      const time = performance.now();
      const dt = Math.min(0.05, (time - lastTime) / 1000);
      lastTime = time;

      const { x: px, y: py, pressed } = pointerRef.current;
      resolveTarget(px, py);

      const mode = modeRef.current;
      const target = targetRef.current;
      const dotVisual = dotVisualRef.current;
      const ringVisual = ringVisualRef.current;
      const reduced = reduceQuery.matches;

      if (mode === "default" || mode === "help") {
        target.x = px;
        target.y = py;
      }

      const dotRate = reduced ? 80 : LERP_DOT;
      const ringRate = reduced ? 80 : LERP_RING;
      const sizeRate = reduced ? 80 : LERP_SIZE;

      // Ring morphs onto magnetic targets (buttons / nodes). The inner dot
      // keeps tracking the pointer so you can still see where you are inside
      // a glued button outline. Focus-lock snaps are the exception — both
      // layers relocate onto the focused word.
      const focusLocked = focusLockKeyRef.current !== null;
      const stickyTarget = mode === "button" || mode === "node";
      const dotTx = stickyTarget && !focusLocked ? px : target.x;
      const dotTy = stickyTarget && !focusLocked ? py : target.y;
      const dotPull = focusLocked ? dotRate * 1.35 : dotRate;

      dotVisual.x = easeToward(dotVisual.x, dotTx, dotPull, dt);
      dotVisual.y = easeToward(dotVisual.y, dotTy, dotPull, dt);

      ringVisual.x = easeToward(ringVisual.x, target.x, ringRate, dt);
      ringVisual.y = easeToward(ringVisual.y, target.y, ringRate, dt);
      ringVisual.width = easeToward(
        ringVisual.width,
        target.width,
        sizeRate,
        dt,
      );
      ringVisual.height = easeToward(
        ringVisual.height,
        target.height,
        sizeRate,
        dt,
      );
      ringVisual.radius = easeToward(
        ringVisual.radius,
        target.radius,
        sizeRate,
        dt,
      );

      const pressScale =
        pressed && mode !== "hidden" && mode !== "help" ? 0.92 : 1;
      root.dataset.mode = mode;
      root.classList.toggle("is-pressed", pressed && mode !== "hidden");

      help.style.transform = `translate(${dotVisual.x}px, ${dotVisual.y}px) translate(-50%, -50%)`;
      dot.style.transform = `translate(${dotVisual.x}px, ${dotVisual.y}px) translate(-50%, -50%) scale(${pressScale})`;

      ring.style.width = `${ringVisual.width}px`;
      ring.style.height = `${ringVisual.height}px`;
      ring.style.borderRadius = `${ringVisual.radius}px`;
      ring.style.transform = `translate(${ringVisual.x}px, ${ringVisual.y}px) translate(-50%, -50%) scale(${pressScale})`;
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current.x = event.clientX;
      pointerRef.current.y = event.clientY;
      pointerRef.current.inside = true;
      const suppressed = suppressedRefRef.current;
      if (suppressed?.current) {
        suppressed.current = false;
        onSuppressedRevealRef.current?.();
      }
      if (!hasPointerSampleRef.current) {
        hasPointerSampleRef.current = true;
        dotVisualRef.current.x = event.clientX;
        dotVisualRef.current.y = event.clientY;
        ringVisualRef.current.x = event.clientX;
        ringVisualRef.current.y = event.clientY;
        targetRef.current.x = event.clientX;
        targetRef.current.y = event.clientY;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") {
        pointerRef.current.pressed = true;
      }
    };
    const onPointerUp = () => {
      pointerRef.current.pressed = false;
    };
    const onPointerLeave = () => {
      pointerRef.current.inside = false;
      modeRef.current = "hidden";
      stickyButtonRef.current = null;
    };

    fineQuery.addEventListener("change", syncEnabled);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    raf = requestAnimationFrame(paint);

    return () => {
      cancelAnimationFrame(raf);
      fineQuery.removeEventListener("change", syncEnabled);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      document.documentElement.classList.remove("has-custom-cursor");
    };
  }, []);

  return (
    <div ref={rootRef} className="custom-cursor" data-mode="hidden" aria-hidden>
      <div ref={ringRef} className="custom-cursor-ring" />
      <div ref={dotRef} className="custom-cursor-dot" />
      <div ref={helpRef} className="custom-cursor-help">
        ?
      </div>
    </div>
  );
}
