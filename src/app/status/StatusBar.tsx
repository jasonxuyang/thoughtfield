import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { CAMERA_FOLLOW } from "../../config/algorithms";
import { activationColorCss } from "../../rendering/activation-style";
import { SITE_DESCRIPTION } from "../../site";
import { normalizeToken } from "../../transcription/normalization";
import type { FocusLockTarget } from "../controls/CustomCursor";
import { HudTooltip } from "../controls/HudTooltip";
import { RecordButton } from "../controls/RecordButton";

/** Matches `.transcript-text` gap / the body mask fade (0.45rem / 1.25rem at 16px). */
const TRANSCRIPT_WORD_GAP_PX = 7;
const TRANSCRIPT_PADDING_START_PX = 20;
const TRANSCRIPT_PADDING_END_PX = 20;
/** Extra inset for scrollToIndex align:"auto" so words clear the side fades. */
const TRANSCRIPT_SCROLL_PADDING_PX = 20;

/** Pin the strip to the trailing edge (past the last word + end fade padding). */
function scrollTranscriptBodyToEnd(body: HTMLElement): void {
  body.scrollLeft = Math.max(0, body.scrollWidth - body.clientWidth);
}
/**
 * Live embeds arrive in small batches (and snapshots can coalesce a few).
 * Hydrate / preview jumps are much larger — skip auto-scroll for those.
 */
const LIVE_EDGE_REVEAL_MAX = 12;
/** Ignore scroll events from our own scrollToIndex for this long. */
const PROGRAMMATIC_SCROLL_GUARD_MS = 1_400;
/** Matches CustomCursor BUTTON_PAD so keyboard lock outlines the same way. */
const CURSOR_FOCUS_PAD = 9;

function focusLockTargetFromRect(
  rect: DOMRect,
  key: string | number,
): FocusLockTarget {
  // Match CustomCursor buttonTargetState: pad the box, keep the element's
  // corner radius (+ pad). Transcript words are square — not a pill.
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width + CURSOR_FOCUS_PAD * 2,
    height: rect.height + CURSOR_FOCUS_PAD * 2,
    radius: CURSOR_FOCUS_PAD,
    key,
  };
}

function estimateTokenWidth(raw: string): number {
  // Space Grotesk ~0.55em at 0.95rem ≈ 8.4px/char; floor for overscan safety.
  return Math.max(12, Math.ceil(raw.length * 8.4));
}

type TranscriptToken = {
  key: string;
  raw: string;
  /** Normalized graph label, or null for fillers / non-graph tokens. */
  label: string | null;
  /** True while still live ASR / not yet on the canvas. */
  redacted: boolean;
};

type BlockPhase = "clear" | "enter" | "hold" | "exit";

/**
 * Align a (possibly cached) block phase with the current redacted flag.
 * Virtualization can unmount a word while it is still blocked; when it
 * remounts after the occurrence has been revealed, the redacted→false
 * transition never fires, so we must not restore enter/hold.
 */
function reconcileBlockPhase(
  phase: BlockPhase,
  redacted: boolean,
  reducedMotion: boolean,
): BlockPhase {
  if (redacted) {
    if (phase === "clear" || phase === "exit") {
      return reducedMotion ? "hold" : "enter";
    }
    return phase;
  }
  // Revealed: drop immediately under reduced motion (no animationend),
  // otherwise play/continue the exit slide.
  if (phase === "clear" || reducedMotion) {
    return "clear";
  }
  return "exit";
}

function tokenize(text: string): string[] {
  return text.trim().length === 0 ? [] : text.trim().split(/\s+/);
}

function buildTokens(
  committed: string,
  pending: string,
  revealedOccurrenceCount: number,
): TranscriptToken[] {
  const tokens: TranscriptToken[] = [];
  // Absolute indices stay stable when a pending word commits.
  let index = 0;
  // Graph occurrences only — stopwords / fillers are not indexed here.
  let occurrenceIndex = 0;

  for (const raw of tokenize(committed)) {
    const normalized = normalizeToken(raw);
    // Reveal in speech order: occurrence N waits until 0..N-1 are embedded.
    let redacted = true;
    if (normalized !== null) {
      redacted = occurrenceIndex >= revealedOccurrenceCount;
      occurrenceIndex += 1;
    }
    tokens.push({
      key: `t-${index}`,
      raw,
      label: normalized,
      redacted,
    });
    index += 1;
  }

  const committedCount = tokens.length;

  for (const raw of tokenize(pending)) {
    tokens.push({
      key: `t-${index}`,
      raw,
      label: normalizeToken(raw),
      redacted: true,
    });
    index += 1;
  }

  // Stop words / fillers never enter the graph. Keep them redacted with the
  // next content word so glue like "the" / "in" doesn't flash white early.
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token || token.label !== null) {
      continue;
    }
    let nextGraphRedacted: boolean | null = null;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const next = tokens[j];
      if (next?.label !== null) {
        nextGraphRedacted = next.redacted;
        break;
      }
    }
    if (nextGraphRedacted !== null) {
      token.redacted = nextGraphRedacted;
    } else {
      // Trailing non-graph words: stay blocked while still live ASR.
      token.redacted = i >= committedCount;
    }
  }

  return tokens;
}

/** Token index for graph occurrence N (fillers / stopwords are skipped). */
function tokenIndexForOccurrence(
  tokens: readonly TranscriptToken[],
  occurrenceIndex: number,
): number {
  let seen = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]?.label === null) {
      continue;
    }
    if (seen === occurrenceIndex) {
      return i;
    }
    seen += 1;
  }
  return -1;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest(
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
    )
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function TranscriptWord({
  raw,
  label,
  redacted,
  phaseCache,
  tokenKey,
  dataIndex,
  measureRef,
  offsetStart,
  interactive,
  focused,
  onActivate,
  onSelect,
  onHoverLeave,
  wordEls,
  activationsRef,
  onFocusedElement,
}: {
  raw: string;
  label: string | null;
  redacted: boolean;
  phaseCache: Map<string, BlockPhase>;
  tokenKey: string;
  dataIndex: number;
  measureRef: (node: HTMLElement | null) => void;
  offsetStart: number;
  interactive: boolean;
  focused: boolean;
  onActivate: (label: string) => void;
  onSelect: (label: string, index: number) => void;
  onHoverLeave: (label: string) => void;
  wordEls: Map<string, Set<HTMLElement>>;
  activationsRef: MutableRefObject<ReadonlyMap<string, number>>;
  onFocusedElement?: (element: HTMLElement) => void;
}) {
  const [phase, setPhase] = useState<BlockPhase>(() => {
    const reducedMotion = prefersReducedMotion();
    const cached = phaseCache.get(tokenKey);
    const initial =
      cached !== undefined
        ? cached
        : redacted
          ? reducedMotion
            ? "hold"
            : "enter"
          : "clear";
    return reconcileBlockPhase(initial, redacted, reducedMotion);
  });
  const prevRedactedRef = useRef(redacted);
  const elementRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    phaseCache.set(tokenKey, phase);
  }, [phase, phaseCache, tokenKey]);

  useLayoutEffect(() => {
    const wasRedacted = prevRedactedRef.current;
    prevRedactedRef.current = redacted;
    const reducedMotion = prefersReducedMotion();

    if (wasRedacted === redacted) {
      // Remount / cache restore can leave phase out of sync with redacted
      // without a prop edge (see reconcileBlockPhase).
      setPhase((current) =>
        reconcileBlockPhase(current, redacted, reducedMotion),
      );
      return;
    }

    if (reducedMotion) {
      setPhase(redacted ? "hold" : "clear");
      return;
    }

    if (redacted) {
      setPhase("enter");
      return;
    }

    // Keep the block mounted and slide it out.
    setPhase("exit");
  }, [redacted]);

  const showBlock = phase === "enter" || phase === "hold" || phase === "exit";
  const hideText = phase === "enter" || phase === "hold";

  // Register for imperative brightness paints (graph ticks → DOM, no React).
  useLayoutEffect(() => {
    const node = elementRef.current;
    if (!label || !node || hideText) {
      return;
    }
    let set = wordEls.get(label);
    if (!set) {
      set = new Set();
      wordEls.set(label, set);
    }
    set.add(node);
    node.style.color = activationColorCss(
      activationsRef.current.get(label) ?? 0,
    );
    return () => {
      set!.delete(node);
      if (set!.size === 0) {
        wordEls.delete(label);
      }
    };
  }, [label, hideText, wordEls, activationsRef]);

  // Keep the custom-cursor focus lock pinned to this occurrence while mounted.
  // Don't clear on unmount — a sibling may already own the ref; the getter
  // validates data-index before using it.
  useLayoutEffect(() => {
    if (!focused || hideText || !onFocusedElement) {
      return;
    }
    const node = elementRef.current;
    if (!node) {
      return;
    }
    onFocusedElement(node);
  }, [focused, hideText, onFocusedElement, dataIndex]);

  return (
    <span
      ref={(node) => {
        elementRef.current = node;
        measureRef(node);
      }}
      data-index={dataIndex}
      data-label={label ?? undefined}
      className={[
        "transcript-word",
        hideText ? "is-redacted" : "",
        phase === "exit" && label !== null ? "is-revealing" : "",
        label === null ? "is-glue" : "",
        interactive && !hideText ? "is-interactive" : "",
        focused && !hideText ? "is-focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        transform: `translateX(${offsetStart}px)`,
        // Stop words never activate — keep them at the resting canvas gray.
        ...(label === null ? { color: activationColorCss(0) } : null),
      }}
      aria-hidden={hideText || undefined}
      onPointerEnter={() => {
        if (!interactive || hideText || !label) {
          return;
        }
        onActivate(label);
      }}
      onPointerLeave={() => {
        if (!label) {
          return;
        }
        onHoverLeave(label);
      }}
      onClick={() => {
        if (!interactive || hideText || !label) {
          return;
        }
        onSelect(label, dataIndex);
      }}
    >
      {showBlock ? (
        <span
          className={[
            "transcript-word-block",
            phase === "enter" ? "is-entering" : "",
            phase === "exit" ? "is-exiting" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) {
              return;
            }
            if (event.animationName === "transcript-block-slide-in") {
              setPhase("hold");
            }
            if (event.animationName === "transcript-block-slide-out") {
              setPhase("clear");
            }
          }}
        />
      ) : null}
      <span className="transcript-word-inner">{raw}</span>
    </span>
  );
}

export function TranscriptPanel({
  committed,
  pending,
  typedPending,
  revealedOccurrenceCount,
  focusedLabel,
  listening,
  ready,
  mediaStream,
  onToggleListen,
  onPasteTranscript,
  onTypedPendingChange,
  onCommitTypedWords,
  onComposerFocus,
  samples,
  onTrySample,
  onActivateLabel,
  onSelectLabel,
  onUserScrollActivity,
  getFollowActivityAt,
  isHomeFollowPaused,
  onCursorLockRelease,
  activationSinkRef,
  scrollToLabelRef,
  focusLockTargetGetterRef,
  releaseCursorLockRef,
}: {
  committed: string;
  pending: string;
  typedPending: string;
  /** Contiguous embedded graph-occurrence prefix (speech-order reveal). */
  revealedOccurrenceCount: number;
  focusedLabel: string | null;
  listening: boolean;
  ready: boolean;
  mediaStream: MediaStream | null;
  onToggleListen: () => void;
  onPasteTranscript: (text: string) => void;
  onTypedPendingChange: (text: string) => void;
  onCommitTypedWords: (text: string) => void;
  /** Text input / mic — clear any focused graph node. */
  onComposerFocus?: () => void;
  samples: ReadonlyArray<{ id: string; label: string; tooltip: string }>;
  onTrySample: (sampleId: string) => void;
  onActivateLabel: (label: string) => void;
  onSelectLabel: (label: string) => void;
  /** User scrolled the strip — pauses shared canvas/transcript follow. */
  onUserScrollActivity?: () => void;
  /**
   * Shared follow clock with the canvas. Canvas pan/zoom bumps this so the
   * transcript doesn't return-to-focus until both sides have been idle.
   */
  getFollowActivityAt?: () => number;
  /**
   * Same pause gate as canvas home-camera (includes forceFollow). Live-edge
   * transcript chase should only run when this is false.
   */
  isHomeFollowPaused?: () => boolean;
  /** Pointer cleared a transcript cursor lock — pause shared follow. */
  onCursorLockRelease?: () => void;
  activationSinkRef: MutableRefObject<
    ((activations: ReadonlyMap<string, number>) => void) | null
  >;
  scrollToLabelRef: MutableRefObject<
    ((
      label: string,
      options?: { lockCursor?: boolean; focus?: boolean },
    ) => void) | null
  >;
  /** Lets the custom cursor outline the keyboard-focused transcript word. */
  focusLockTargetGetterRef: MutableRefObject<
    (() => FocusLockTarget | null) | null
  >;
  /** Imperative unlock (e.g. Escape / programmatic clear). */
  releaseCursorLockRef?: MutableRefObject<(() => void) | null>;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrubTrackRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  /** Active scrub pointer id — window listeners end the drag even if capture drops. */
  const scrubPointerIdRef = useRef<number | null>(null);
  const scrubWindowCleanupRef = useRef<(() => void) | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement | null>(null);
  const typeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const typingComposingRef = useRef(false);
  const pendingScrollToEndRef = useRef(false);
  const phaseCacheRef = useRef(new Map<string, BlockPhase>());
  const prevTokenCountRef = useRef(0);
  const hoveredLabelRef = useRef<string | null>(null);
  /** Scroll scrubber: progress 0–1 along the overflow, only when content overflows. */
  const [scrub, setScrub] = useState({ progress: 0, canScrub: false });
  /** Hover preview along the scrub (null when pointer is away). */
  const [scrubGhost, setScrubGhost] = useState<number | null>(null);
  /** Keep the hover-only scrub visible while dragging outside the panel. */
  const [scrubActive, setScrubActive] = useState(false);
  /**
   * Which transcript occurrence is focused. Index (not just label) matters
   * because the strip is virtualized and the same word can appear twice.
   */
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const focusedIndexRef = useRef<number | null>(null);
  focusedIndexRef.current = focusedIndex;
  /** After arrow-key nav, lock the custom cursor onto that word until pointer moves. */
  const cursorFocusLockRef = useRef(false);
  /** Live DOM node for the focused occurrence (null while virtualized away). */
  const focusedWordElRef = useRef<HTMLElement | null>(null);
  /** Last good lock box — keeps the cursor parked while a word remounts. */
  const lastFocusLockTargetRef = useRef<FocusLockTarget | null>(null);
  /** First pointer sample after a lock — used so tiny jitter doesn't unlock. */
  const cursorLockOriginRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * User scrolled away from the focused word — like canvas userOverride.
   * After idle, we ease back to the focused occurrence.
   */
  const userScrollOverrideRef = useRef(false);
  const lastUserScrollAtRef = useRef(0);
  /** Pointer is over the transcript strip — suppress live-edge auto-scroll. */
  const pointerOverTranscriptRef = useRef(false);
  /** Ignore scroll events until this timestamp (programmatic scrollToIndex). */
  const programmaticScrollUntilRef = useRef(0);
  /** Prior reveal prefix — live-edge scroll only when a small batch lands. */
  const prevRevealedCountRef = useRef(0);
  /**
   * Occurrence to chase once shared follow idle clears (canvas home-chase
   * resumes every frame; transcript only gets one shot per reveal otherwise).
   */
  const pendingLiveScrollOccurrenceRef = useRef<number | null>(null);
  const wordElsRef = useRef(new Map<string, Set<HTMLElement>>());
  const activationsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [draft, setDraft] = useState("");
  const tokens = buildTokens(committed, pending, revealedOccurrenceCount);
  const hasTranscript = tokens.length > 0;
  const isTyping = typedPending.length > 0;
  const hasTypedDraft = typedPending.trim().length > 0;
  const showEntry = !hasTranscript && !listening && !isTyping;

  if (tokens.length < prevTokenCountRef.current) {
    phaseCacheRef.current.clear();
  }
  prevTokenCountRef.current = tokens.length;

  const paintActivations = useEffectEvent(
    (activations: ReadonlyMap<string, number>) => {
      activationsRef.current = activations;
      for (const [label, els] of wordElsRef.current) {
        const color = activationColorCss(activations.get(label) ?? 0);
        for (const el of els) {
          if (el.classList.contains("is-redacted")) {
            continue;
          }
          if (el.style.color === color) {
            continue;
          }
          el.style.color = color;
        }
      }
    },
  );

  useEffect(() => {
    activationSinkRef.current = paintActivations;
    return () => {
      if (activationSinkRef.current === paintActivations) {
        activationSinkRef.current = null;
      }
    };
  }, [activationSinkRef]);

  const handleActivate = useEffectEvent((label: string) => {
    // Same enter-only gate as Pixi hover — don't re-pulse while parked on a word.
    if (hoveredLabelRef.current === label) {
      return;
    }
    hoveredLabelRef.current = label;
    onActivateLabel(label);
  });

  const handleHoverLeave = useEffectEvent((label: string) => {
    if (hoveredLabelRef.current === label) {
      hoveredLabelRef.current = null;
    }
  });

  const handleSelect = useEffectEvent((label: string, index: number) => {
    // Intentional click — cancel free-scroll override so we stay with focus.
    userScrollOverrideRef.current = false;
    lastUserScrollAtRef.current = 0;
    setFocusedIndex(index);
    onSelectLabel(label);
  });

  const virtualizer = useVirtualizer({
    count: tokens.length,
    horizontal: true,
    getScrollElement: () => bodyRef.current,
    estimateSize: (index) => estimateTokenWidth(tokens[index]?.raw ?? ""),
    gap: TRANSCRIPT_WORD_GAP_PX,
    paddingStart: TRANSCRIPT_PADDING_START_PX,
    paddingEnd: TRANSCRIPT_PADDING_END_PX,
    scrollPaddingStart: TRANSCRIPT_SCROLL_PADDING_PX,
    scrollPaddingEnd: TRANSCRIPT_SCROLL_PADDING_PX,
    overscan: 12,
    getItemKey: (index) => tokens[index]?.key ?? index,
  });

  const markTranscriptActivity = useEffectEvent(() => {
    userScrollOverrideRef.current = true;
    lastUserScrollAtRef.current = performance.now();
    onUserScrollActivity?.();
  });

  /** Latest of local scrub/scroll and shared canvas follow activity. */
  const followIdleMs = useEffectEvent((): number => {
    const shared = getFollowActivityAt?.() ?? 0;
    const latest = Math.max(lastUserScrollAtRef.current, shared);
    if (latest <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    return performance.now() - latest;
  });

  const syncScrubFromScroll = useEffectEvent(() => {
    const body = bodyRef.current;
    if (!body) {
      setScrub((previous) =>
        previous.canScrub || previous.progress !== 0
          ? { progress: 0, canScrub: false }
          : previous,
      );
      return;
    }
    const maxScroll = body.scrollWidth - body.clientWidth;
    const canScrub = maxScroll > 1;
    const progress = canScrub
      ? Math.min(1, Math.max(0, body.scrollLeft / maxScroll))
      : 0;
    setScrub((previous) => {
      if (
        previous.canScrub === canScrub &&
        Math.abs(previous.progress - progress) < 0.0005
      ) {
        return previous;
      }
      return { progress, canScrub };
    });
  });

  const scrubProgressFromClientX = useEffectEvent(
    (clientX: number): number | null => {
      const track = scrubTrackRef.current;
      if (!track) {
        return null;
      }
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) {
        return null;
      }
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    },
  );

  const scrubToClientX = useEffectEvent((clientX: number) => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const maxScroll = body.scrollWidth - body.clientWidth;
    if (maxScroll <= 1) {
      return;
    }
    const t = scrubProgressFromClientX(clientX);
    if (t === null) {
      return;
    }
    body.scrollLeft = t * maxScroll;
    markTranscriptActivity();
    setScrub({ progress: t, canScrub: true });
  });

  const endScrubGesture = useEffectEvent(
    (clientX: number, clientY: number) => {
      if (!scrubbingRef.current && scrubPointerIdRef.current === null) {
        return;
      }
      scrubbingRef.current = false;
      scrubPointerIdRef.current = null;
      const track = scrubTrackRef.current;
      track?.classList.remove("is-active");
      setScrubActive(false);

      const under = document.elementFromPoint(clientX, clientY);
      const overScrub = !!under?.closest(".transcript-scrub");
      pointerOverTranscriptRef.current = !!under?.closest(".transcript-scroll");
      if (overScrub) {
        setScrubGhost(scrubProgressFromClientX(clientX));
      } else {
        setScrubGhost(null);
      }
    },
  );

  const beginScrubGesture = useEffectEvent(
    (track: HTMLElement, pointerId: number, clientX: number) => {
      scrubWindowCleanupRef.current?.();

      scrubbingRef.current = true;
      scrubPointerIdRef.current = pointerId;
      // Sync before React paint so the custom cursor can lock immediately.
      track.classList.add("is-active");
      setScrubActive(true);
      pointerOverTranscriptRef.current = true;
      scrubToClientX(clientX);
      setScrubGhost(scrubProgressFromClientX(clientX));

      try {
        track.setPointerCapture(pointerId);
      } catch {
        // Capture is best-effort; window listeners still own the gesture.
      }

      let finished = false;
      const finish = (event: PointerEvent) => {
        if (finished || event.pointerId !== pointerId) {
          return;
        }
        finished = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        track.removeEventListener("lostpointercapture", onLostCapture);
        scrubWindowCleanupRef.current = null;
        if (track.hasPointerCapture(pointerId)) {
          try {
            track.releasePointerCapture(pointerId);
          } catch {
            // Already released.
          }
        }
        endScrubGesture(event.clientX, event.clientY);
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId || !scrubbingRef.current) {
          return;
        }
        scrubToClientX(event.clientX);
        setScrubGhost(scrubProgressFromClientX(event.clientX));
      };
      const onEnd = (event: PointerEvent) => {
        finish(event);
      };
      const onLostCapture = (event: PointerEvent) => {
        // Only end if this was our capture and we haven't already finished.
        if (event.pointerId !== pointerId || finished) {
          return;
        }
        // A later setPointerCapture elsewhere — still end our scrub session.
        finish(event);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      track.addEventListener("lostpointercapture", onLostCapture);
      scrubWindowCleanupRef.current = () => {
        if (finished) {
          return;
        }
        finished = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        track.removeEventListener("lostpointercapture", onLostCapture);
        scrubWindowCleanupRef.current = null;
        endScrubGesture(clientX, 0);
      };
    },
  );

  /**
   * Hovering, focus inspection, or canvas follow-pause — don't yank the strip.
   * Uses the same pause gate as home-camera (incl. forceFollow) so both
   * viewports chase in lockstep.
   * Focus inspection is optional so typed commits can still clear focus + chase.
   */
  const isLiveEdgeAutoScrollSuppressed = useEffectEvent(
    (options?: { includeFocus?: boolean }): boolean => {
      if (pointerOverTranscriptRef.current) {
        return true;
      }
      if (options?.includeFocus !== false) {
        if (focusedLabel !== null || focusedIndexRef.current !== null) {
          return true;
        }
      }
      if (isHomeFollowPaused) {
        return isHomeFollowPaused();
      }
      return followIdleMs() < CAMERA_FOLLOW.idleReturnMs;
    },
  );

  /**
   * Scroll a token into view. Instant jumps re-align after measure; smooth
   * scrolls are left alone so a post-measure `auto` nudge doesn't cancel them.
   */
  const scrollToTokenIndex = useEffectEvent(
    (
      index: number,
      options?: {
        align?: "auto" | "start" | "center" | "end";
        behavior?: ScrollBehavior;
      },
    ) => {
      if (index < 0 || index >= tokens.length) {
        return;
      }
      const align = options?.align ?? "center";
      const behavior =
        options?.behavior ??
        (prefersReducedMotion() ? "auto" : "smooth");

      // Programmatic chase — clear free-scroll override (same as camera focusNode).
      userScrollOverrideRef.current = false;
      programmaticScrollUntilRef.current =
        performance.now() +
        (behavior === "smooth" ? PROGRAMMATIC_SCROLL_GUARD_MS : 120);

      virtualizer.scrollToIndex(index, { align, behavior });

      if (behavior !== "auto") {
        return;
      }

      // Dynamic sizes: after measure, reconcile again with instant scroll.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticScrollUntilRef.current =
            performance.now() + 120;
          virtualizer.scrollToIndex(index, { align, behavior: "auto" });
        });
      });
    },
  );

  /**
   * Scroll to a revealed graph occurrence, or defer until canvas follow resumes.
   * Instant scroll + remeasure — smooth virtualizer jumps often no-op on estimates.
   */
  const chaseRevealedOccurrence = useEffectEvent((occurrenceIndex: number) => {
    // Don't fight pinned inspection — drop any deferred live chase.
    if (focusedLabel !== null || focusedIndexRef.current !== null) {
      pendingLiveScrollOccurrenceRef.current = null;
      return;
    }
    if (isLiveEdgeAutoScrollSuppressed({ includeFocus: false })) {
      pendingLiveScrollOccurrenceRef.current = occurrenceIndex;
      return;
    }
    const targetIndex = tokenIndexForOccurrence(tokens, occurrenceIndex);
    if (targetIndex < 0) {
      return;
    }
    pendingLiveScrollOccurrenceRef.current = null;
    scrollToTokenIndex(targetIndex, {
      align: "end",
      behavior: "auto",
    });
  });

  const scrollToLabel = useEffectEvent(
    (
      label: string,
      options?: { lockCursor?: boolean; focus?: boolean },
    ) => {
      let index = -1;
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (token?.label === label && !token.redacted) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        return;
      }
      // focus:false — scroll only, no highlight / cursor steal.
      if (options?.focus !== false) {
        focusedIndexRef.current = index;
        setFocusedIndex(index);
      }
      if (options?.lockCursor) {
        cursorFocusLockRef.current = true;
        cursorLockOriginRef.current = null;
      }
      // Node click: only nudge into view — don't yank the word to center.
      scrollToTokenIndex(index, {
        align: "auto",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    },
  );

  const releaseCursorLock = useEffectEvent(
    (options?: { silent?: boolean }) => {
      if (!cursorFocusLockRef.current) {
        return;
      }
      cursorFocusLockRef.current = false;
      cursorLockOriginRef.current = null;
      lastFocusLockTargetRef.current = null;
      // Tour locks without a selected label — drop the highlight with the lock.
      if (focusedLabel === null) {
        setFocusedIndex(null);
      }
      if (!options?.silent) {
        onCursorLockRelease?.();
      }
    },
  );

  const navigateFocusedWord = useEffectEvent(
    (direction: -1 | 1, options?: { repeat?: boolean }) => {
      const focusable: number[] = [];
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token?.label !== null && !token.redacted) {
          focusable.push(i);
        }
      }
      if (focusable.length === 0) {
        return;
      }

      let currentPos = -1;
      const marked = focusedIndexRef.current;
      if (
        marked !== null &&
        tokens[marked]?.label !== null &&
        !tokens[marked]?.redacted
      ) {
        currentPos = focusable.indexOf(marked);
      }
      if (currentPos < 0 && focusedLabel !== null) {
        for (let i = focusable.length - 1; i >= 0; i -= 1) {
          if (tokens[focusable[i]]?.label === focusedLabel) {
            currentPos = i;
            break;
          }
        }
      }

      const nextPos =
        currentPos < 0
          ? direction > 0
            ? 0
            : focusable.length - 1
          : currentPos + direction;
      if (nextPos < 0 || nextPos >= focusable.length) {
        return;
      }

      const index = focusable[nextPos];
      const label = tokens[index]?.label;
      if (label === null || label === undefined) {
        return;
      }

      // Sync immediately — CustomCursor reads this ref before React re-renders.
      focusedIndexRef.current = index;
      setFocusedIndex(index);
      onSelectLabel(label);
      cursorFocusLockRef.current = true;
      cursorLockOriginRef.current = null;
      // Single taps ease; held-key repeat stays instant so scrubbing doesn't
      // stack smooth scrolls across unmeasured virtual ranges.
      const behavior =
        options?.repeat || prefersReducedMotion() ? "auto" : "smooth";
      scrollToTokenIndex(index, { align: "center", behavior });
    },
  );

  const registerFocusedWordEl = useEffectEvent((element: HTMLElement) => {
    focusedWordElRef.current = element;
  });

  const resolveFocusLockTarget = useEffectEvent((): FocusLockTarget | null => {
    if (!cursorFocusLockRef.current) {
      lastFocusLockTargetRef.current = null;
      return null;
    }
    const index = focusedIndexRef.current;
    if (index === null) {
      return lastFocusLockTargetRef.current;
    }

    const live = focusedWordElRef.current;
    if (
      live &&
      document.contains(live) &&
      live.dataset.index === String(index)
    ) {
      const target = focusLockTargetFromRect(
        live.getBoundingClientRect(),
        index,
      );
      lastFocusLockTargetRef.current = target;
      return target;
    }

    const mounted = document.querySelector<HTMLElement>(
      `.transcript-word[data-index="${index}"]`,
    );
    if (mounted) {
      focusedWordElRef.current = mounted;
      const target = focusLockTargetFromRect(
        mounted.getBoundingClientRect(),
        index,
      );
      lastFocusLockTargetRef.current = target;
      return target;
    }

    // Word not mounted yet (smooth scroll / virtualization) — chase from layout.
    const body = bodyRef.current;
    if (!body) {
      return lastFocusLockTargetRef.current;
    }
    const item = virtualizer.measurementsCache[index];
    const size = item?.size ?? estimateTokenWidth(tokens[index]?.raw ?? "");
    let start = item?.start;
    if (start === undefined) {
      // Build a cheap prefix estimate when the cache hasn't measured this index.
      start = TRANSCRIPT_PADDING_START_PX;
      for (let i = 0; i < index; i += 1) {
        const measured = virtualizer.measurementsCache[i];
        start +=
          (measured?.size ?? estimateTokenWidth(tokens[i]?.raw ?? "")) +
          TRANSCRIPT_WORD_GAP_PX;
      }
    }
    const bodyRect = body.getBoundingClientRect();
    const centerX = bodyRect.left - body.scrollLeft + start + size / 2;
    const centerY = bodyRect.top + bodyRect.height / 2;
    const wordHeight = Math.max(16, Math.min(bodyRect.height - 10, 28));
    const target: FocusLockTarget = {
      x: centerX,
      y: centerY,
      width: size + CURSOR_FOCUS_PAD * 2,
      height: wordHeight + CURSOR_FOCUS_PAD * 2,
      radius: CURSOR_FOCUS_PAD,
      key: index,
    };
    lastFocusLockTargetRef.current = target;
    return target;
  });

  useEffect(() => {
    focusLockTargetGetterRef.current = () => resolveFocusLockTarget();
    return () => {
      if (focusLockTargetGetterRef.current) {
        focusLockTargetGetterRef.current = null;
      }
    };
  }, [focusLockTargetGetterRef]);

  useEffect(() => {
    if (!hasTranscript) {
      setFocusedIndex(null);
      focusedIndexRef.current = null;
      cursorFocusLockRef.current = false;
      cursorLockOriginRef.current = null;
      lastFocusLockTargetRef.current = null;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // Draft caret owns arrows only while text is in progress.
      if (typedPending.length > 0) {
        return;
      }
      if (
        isEditableKeyboardTarget(event.target) &&
        event.target !== typeInputRef.current
      ) {
        return;
      }

      event.preventDefault();
      navigateFocusedWord(event.key === "ArrowRight" ? 1 : -1, {
        repeat: event.repeat,
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!cursorFocusLockRef.current) {
        return;
      }
      const origin = cursorLockOriginRef.current;
      if (!origin) {
        cursorLockOriginRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
        return;
      }
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (dx * dx + dy * dy > 64) {
        releaseCursorLock();
      }
    };

    const onPointerDown = () => {
      releaseCursorLock();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, {
      passive: true,
    });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [hasTranscript, typedPending]);

  useEffect(() => {
    if (!releaseCursorLockRef) {
      return;
    }
    // Silent — tour teardown shouldn't re-enter activity bumping.
    const unlock = () => {
      releaseCursorLock({ silent: true });
    };
    releaseCursorLockRef.current = unlock;
    return () => {
      if (releaseCursorLockRef.current === unlock) {
        releaseCursorLockRef.current = null;
      }
    };
  }, [releaseCursorLockRef]);

  useEffect(() => {
    if (focusedLabel === null) {
      // Keep transient cursor locks; only clear when unlocked.
      if (!cursorFocusLockRef.current) {
        setFocusedIndex(null);
        userScrollOverrideRef.current = false;
      }
      return;
    }
    setFocusedIndex((current) => {
      if (
        current !== null &&
        tokens[current]?.label === focusedLabel &&
        !tokens[current]?.redacted
      ) {
        return current;
      }
      for (let i = tokens.length - 1; i >= 0; i -= 1) {
        const token = tokens[i];
        if (token?.label === focusedLabel && !token.redacted) {
          return i;
        }
      }
      return null;
    });
  }, [focusedLabel, committed, pending, revealedOccurrenceCount]);

  useEffect(() => {
    scrollToLabelRef.current = scrollToLabel;
    return () => {
      if (scrollToLabelRef.current === scrollToLabel) {
        scrollToLabelRef.current = null;
      }
    };
  }, [scrollToLabelRef]);

  useEffect(() => {
    const prev = prevRevealedCountRef.current;
    const added = revealedOccurrenceCount - prev;
    prevRevealedCountRef.current = revealedOccurrenceCount;

    // Chase the newly revealed occurrence (same word the camera focuses), not
    // the strip end / pending ASR block. Small batches only — skip hydrate jumps.
    if (added > LIVE_EDGE_REVEAL_MAX) {
      pendingLiveScrollOccurrenceRef.current = null;
      return;
    }
    if (added < 1 || tokens.length === 0) {
      return;
    }
    // Latest processed occurrence in this reveal (matches focusNodeId = last apply).
    chaseRevealedOccurrence(revealedOccurrenceCount - 1);
  }, [revealedOccurrenceCount, tokens.length, virtualizer, focusedLabel]);

  // Free-scroll the strip; after idle, ease back to the focused word
  // (mirrors canvas CAMERA_FOLLOW.idleReturnMs).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !hasTranscript) {
      return;
    }

    const onPointerEnter = () => {
      pointerOverTranscriptRef.current = true;
      markTranscriptActivity();
    };
    const onPointerLeave = () => {
      // Drop hover suppress immediately; idle timer still covers recent scrubbing.
      pointerOverTranscriptRef.current = false;
    };
    const onPointerDown = () => {
      markTranscriptActivity();
    };
    const onWheel = () => {
      markTranscriptActivity();
    };
    const onTouchMove = () => {
      markTranscriptActivity();
    };
    const onScroll = () => {
      syncScrubFromScroll();
      // Smooth programmatic scrolls emit many events; keep the guard alive
      // until they settle so focus chase doesn't look like user input.
      if (
        scrubbingRef.current ||
        performance.now() < programmaticScrollUntilRef.current
      ) {
        if (!scrubbingRef.current) {
          programmaticScrollUntilRef.current = performance.now() + 200;
        }
        return;
      }
      markTranscriptActivity();
    };

    el.addEventListener("pointerenter", onPointerEnter);
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });

    syncScrubFromScroll();
    const resizeObserver = new ResizeObserver(() => {
      syncScrubFromScroll();
    });
    resizeObserver.observe(el);

    const idleTimer = window.setInterval(() => {
      // Held scrub — keep the shared follow clock alive for the whole press.
      if (scrubbingRef.current) {
        markTranscriptActivity();
        return;
      }
      // Canvas home-chase resumes after idle; flush a deferred reveal chase too.
      const pendingLive = pendingLiveScrollOccurrenceRef.current;
      if (pendingLive !== null) {
        chaseRevealedOccurrence(pendingLive);
      }
      if (!userScrollOverrideRef.current) {
        return;
      }
      const index = focusedIndexRef.current;
      if (index === null) {
        userScrollOverrideRef.current = false;
        return;
      }
      // Shared with canvas home-chase — both resume only after the same idle.
      if (followIdleMs() < CAMERA_FOLLOW.idleReturnMs) {
        return;
      }
      scrollToTokenIndex(index, {
        align: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }, 200);

    return () => {
      el.removeEventListener("pointerenter", onPointerEnter);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      window.clearInterval(idleTimer);
    };
  }, [hasTranscript]);

  // Drop an in-flight scrub if the panel unmounts mid-drag.
  useEffect(() => {
    return () => {
      scrubWindowCleanupRef.current?.();
    };
  }, []);

  // Content width changes (new words / measure) — keep the scrub thumb honest.
  useLayoutEffect(() => {
    if (!hasTranscript) {
      setScrub({ progress: 0, canScrub: false });
      setScrubGhost(null);
      return;
    }
    syncScrubFromScroll();
  }, [hasTranscript, tokens.length, virtualizer.getTotalSize()]);

  useEffect(() => {
    if (!showEntry) {
      return;
    }
    pasteRef.current?.focus();
  }, [showEntry]);

  const submitDraft = useEffectEvent(() => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onPasteTranscript(text);
    setDraft("");
  });

  /** Keep the strip parked on the live edge when typing commits words. */
  const scrollTranscriptToEnd = useEffectEvent(() => {
    if (tokens.length === 0) {
      return;
    }
    // Respect an in-progress read / scrub of earlier words.
    if (isLiveEdgeAutoScrollSuppressed({ includeFocus: false })) {
      return;
    }
    setFocusedIndex(null);
    focusedIndexRef.current = null;
    cursorFocusLockRef.current = false;
    userScrollOverrideRef.current = false;
    programmaticScrollUntilRef.current = performance.now() + 200;
    const body = bodyRef.current;
    if (body) {
      scrollTranscriptBodyToEnd(body);
    }
    // After measure, pin again so end padding clears the right fade.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (body) {
          scrollTranscriptBodyToEnd(body);
        }
      });
    });
  });

  const focusTypeInput = useEffectEvent(() => {
    typeInputRef.current?.focus();
  });

  const commitTypedDraft = useEffectEvent(() => {
    const text = typedPending.trim();
    if (!text) {
      onTypedPendingChange("");
      return;
    }
    // Fold into committed transcript — strip shows blocked words until spheres land.
    onCommitTypedWords(text);
    onTypedPendingChange("");
    pendingScrollToEndRef.current = true;
  });

  const applyTypedPaste = useEffectEvent((pasted: string) => {
    if (!pasted) {
      return;
    }
    // Keep the draft intact until Enter / submit — spaces no longer commit.
    onTypedPendingChange(`${typedPending}${pasted}`);
  });

  // After typed words fold into the strip, chase the live edge once measured.
  useLayoutEffect(() => {
    if (!pendingScrollToEndRef.current) {
      return;
    }
    pendingScrollToEndRef.current = false;
    scrollTranscriptToEnd();
  }, [committed, tokens.length]);

  // Global capture: start typing from anywhere (cancels record via App).
  useEffect(() => {
    if (showEntry) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        focusTypeInput();
        commitTypedDraft();
        return;
      }
      if (event.key === "Backspace") {
        focusTypeInput();
        if (typedPending.length > 0) {
          event.preventDefault();
          onTypedPendingChange(typedPending.slice(0, -1));
        }
        return;
      }
      if (event.key.length !== 1) {
        return;
      }
      event.preventDefault();
      focusTypeInput();
      onTypedPendingChange(`${typedPending}${event.key}`);
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) {
        return;
      }
      event.preventDefault();
      focusTypeInput();
      applyTypedPaste(text);
    };

    const onCopy = (event: ClipboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        const input = typeInputRef.current;
        if (
          input &&
          document.activeElement === input &&
          input.selectionStart !== input.selectionEnd
        ) {
          return;
        }
      }
      const text = [committed, typedPending].filter(Boolean).join(" ").trim();
      if (!text) {
        return;
      }
      event.preventDefault();
      event.clipboardData?.setData("text/plain", text);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    window.addEventListener("copy", onCopy);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("copy", onCopy);
    };
  }, [showEntry, typedPending, committed]);

  if (showEntry) {
    return (
      <aside className="transcript-panel is-entry">
        <div className="transcript-entry">
          <header className="transcript-entry-intro">
            <h1 className="transcript-entry-brand">Thoughtfield</h1>
            <p className="transcript-entry-blurb">{SITE_DESCRIPTION}</p>
          </header>
          <div className="transcript-paste-field">
            <textarea
              ref={pasteRef}
              className="transcript-paste"
              value={draft}
              placeholder="Type to begin..."
              spellCheck={false}
              autoComplete="off"
              autoFocus
              rows={1}
              aria-label="Type to begin"
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (!pasted.trim() || draft.trim()) {
                  return;
                }
                event.preventDefault();
                onPasteTranscript(pasted);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submitDraft();
                }
              }}
            />
            <div className="transcript-entry-actions">
              {draft.trim() ? (
                <button
                  type="button"
                  className="transcript-entry-action"
                  aria-label="Submit transcript"
                  onClick={submitDraft}
                >
                  <svg
                    className="transcript-entry-action-icon"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M12 4.5a1 1 0 0 1 .7.3l5.5 5.5a1 1 0 1 1-1.4 1.4L13 7.9V19a1 1 0 1 1-2 0V7.9L7.2 11.7a1 1 0 1 1-1.4-1.4l5.5-5.5a1 1 0 0 1 .7-.3Z"
                    />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className="transcript-entry-action"
                  disabled={!ready}
                  aria-label="Use voice"
                  onClick={onToggleListen}
                >
                  <svg
                    className="transcript-entry-action-icon"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    aria-hidden="true"
                  >
                    <path
                      fill="currentColor"
                      d="M12 2a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 1 0 7 0v-6A3.5 3.5 0 0 0 12 2Zm-6 9.5a1 1 0 1 0-2 0 8 8 0 0 0 7 7.94V21H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-1.56A8 8 0 0 0 20 11.5a1 1 0 1 0-2 0 6 6 0 1 1-12 0Z"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div
            className="transcript-sample-list"
            role="group"
            aria-label="Example Thoughtfields"
          >
            {samples.map((sample, index) => (
              <span key={sample.id} className="transcript-sample-item">
                {index > 0 ? (
                  <span className="transcript-sample-sep" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <HudTooltip text={sample.tooltip} preferredPlacement="above">
                  <button
                    type="button"
                    className="transcript-try-sample"
                    onClick={() => onTrySample(sample.id)}
                  >
                    {sample.label}
                  </button>
                </HudTooltip>
              </span>
            ))}
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`transcript-panel${hasTranscript || isTyping ? "" : " is-empty"}`}
    >
      <div className="transcript-toolbar">
        <div
          className={`transcript-typing-field${listening ? " is-listening" : ""}`}
        >
          <textarea
            ref={typeInputRef}
            className="transcript-typing-input"
            value={typedPending}
            placeholder="Keep typing..."
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={1}
            aria-label="Type into transcript"
            onFocus={() => {
              onComposerFocus?.();
            }}
            onChange={(event) => {
              onTypedPendingChange(event.target.value);
            }}
            onCompositionStart={() => {
              typingComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              typingComposingRef.current = false;
              onTypedPendingChange(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || typingComposingRef.current) {
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                commitTypedDraft();
              }
            }}
            onPaste={(event) => {
              event.preventDefault();
              applyTypedPaste(event.clipboardData.getData("text/plain"));
            }}
            onCopy={(event) => {
              const input = event.currentTarget;
              if (input.selectionStart !== input.selectionEnd) {
                return;
              }
              const text = [committed, typedPending]
                .filter(Boolean)
                .join(" ")
                .trim();
              if (!text) {
                return;
              }
              event.preventDefault();
              event.clipboardData.setData("text/plain", text);
            }}
          />
          <div className="transcript-typing-actions">
            {hasTypedDraft ? (
              <button
                type="button"
                className="transcript-entry-action"
                aria-label="Submit transcript"
                onClick={commitTypedDraft}
              >
                <svg
                  className="transcript-entry-action-icon"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path
                    fill="currentColor"
                    d="M12 4.5a1 1 0 0 1 .7.3l5.5 5.5a1 1 0 1 1-1.4 1.4L13 7.9V19a1 1 0 1 1-2 0V7.9L7.2 11.7a1 1 0 1 1-1.4-1.4l5.5-5.5a1 1 0 0 1 .7-.3Z"
                  />
                </svg>
              </button>
            ) : (
              <RecordButton
                listening={listening}
                ready={ready}
                stream={mediaStream}
                onToggle={onToggleListen}
              />
            )}
          </div>
        </div>
      </div>
      <div className="transcript-scroll">
        {hasTranscript && scrub.canScrub ? (
          <div
            ref={scrubTrackRef}
            className={`transcript-scrub${scrubActive ? " is-active" : ""}`}
            role="slider"
            aria-label="Scrub transcript"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrub.progress * 100)}
            tabIndex={0}
            onPointerEnter={(event) => {
              pointerOverTranscriptRef.current = true;
              markTranscriptActivity();
              if (!scrubbingRef.current) {
                setScrubGhost(scrubProgressFromClientX(event.clientX));
              }
            }}
            onPointerLeave={() => {
              if (!scrubbingRef.current) {
                pointerOverTranscriptRef.current = false;
                setScrubGhost(null);
              }
            }}
            onPointerDown={(event) => {
              // Own the gesture so the canvas under the panel can't select a node.
              event.preventDefault();
              event.stopPropagation();
              beginScrubGesture(
                event.currentTarget,
                event.pointerId,
                event.clientX,
              );
            }}
            onPointerMove={(event) => {
              // Drag moves are handled on window so release-outside always ends.
              if (scrubbingRef.current) {
                return;
              }
              setScrubGhost(scrubProgressFromClientX(event.clientX));
            }}
            onKeyDown={(event) => {
              const body = bodyRef.current;
              if (!body) {
                return;
              }
              const maxScroll = body.scrollWidth - body.clientWidth;
              if (maxScroll <= 1) {
                return;
              }
              const step = Math.max(48, body.clientWidth * 0.2);
              if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                event.preventDefault();
                body.scrollLeft = Math.max(0, body.scrollLeft - step);
                markTranscriptActivity();
                syncScrubFromScroll();
              } else if (
                event.key === "ArrowRight" ||
                event.key === "ArrowUp"
              ) {
                event.preventDefault();
                body.scrollLeft = Math.min(maxScroll, body.scrollLeft + step);
                markTranscriptActivity();
                syncScrubFromScroll();
              } else if (event.key === "Home") {
                event.preventDefault();
                body.scrollLeft = 0;
                markTranscriptActivity();
                syncScrubFromScroll();
              } else if (event.key === "End") {
                event.preventDefault();
                body.scrollLeft = maxScroll;
                markTranscriptActivity();
                syncScrubFromScroll();
              }
            }}
          >
            {scrubGhost !== null && !scrubActive ? (
              <div
                className="transcript-scrub-ghost"
                style={{
                  left: `calc(${scrubGhost} * (100% - 0.45rem) + 0.225rem)`,
                }}
              />
            ) : null}
            <div
              className="transcript-scrub-thumb"
              style={{
                left: `calc(${scrub.progress} * (100% - 0.45rem) + 0.225rem)`,
              }}
            />
          </div>
        ) : null}
        <div
          className="transcript-body"
          ref={bodyRef}
          onPointerDown={(event) => {
            // Keep word clicks for focus/select; empty chrome starts typing.
            if (
              event.target instanceof Element &&
              event.target.closest(".transcript-word.is-interactive")
            ) {
              return;
            }
            focusTypeInput();
          }}
        >
          {hasTranscript ? (
            <div
              className="transcript-text"
              style={{ width: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const token = tokens[item.index];
                if (!token) {
                  return null;
                }
                const interactive = token.label !== null && !token.redacted;
                // Prefer occurrence index so virtualized duplicates don't all light up.
                const focused =
                  !token.redacted &&
                  (focusedIndex !== null
                    ? item.index === focusedIndex
                    : focusedLabel !== null && token.label === focusedLabel);
                return (
                  <TranscriptWord
                    key={token.key}
                    tokenKey={token.key}
                    raw={token.raw}
                    label={token.label}
                    redacted={token.redacted}
                    phaseCache={phaseCacheRef.current}
                    dataIndex={item.index}
                    measureRef={virtualizer.measureElement}
                    offsetStart={item.start}
                    interactive={interactive}
                    focused={focused}
                    onActivate={handleActivate}
                    onSelect={handleSelect}
                    onHoverLeave={handleHoverLeave}
                    wordEls={wordElsRef.current}
                    activationsRef={activationsRef}
                    onFocusedElement={registerFocusedWordEl}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
