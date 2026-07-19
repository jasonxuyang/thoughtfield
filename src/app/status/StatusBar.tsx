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
import { THOUGHTFIELD_BLURB } from "../../demo/entry-preview-graph";
import { activationColorCss } from "../../rendering/activation-style";
import { normalizeToken } from "../../transcription/normalization";
import { HudTooltip } from "../controls/HudTooltip";
import { RecordButton } from "../controls/RecordButton";

/** Matches `.transcript-text` gap / padding-inline (0.45rem / 0.5rem / 1.25rem at 16px). */
const TRANSCRIPT_WORD_GAP_PX = 7;
const TRANSCRIPT_PADDING_START_PX = 8;
const TRANSCRIPT_PADDING_END_PX = 20;
/** Ignore scroll events from our own scrollToIndex for this long. */
const PROGRAMMATIC_SCROLL_GUARD_MS = 1_400;

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

function tokenize(text: string): string[] {
  return text.trim().length === 0 ? [] : text.trim().split(/\s+/);
}

function buildTokens(
  committed: string,
  pending: string,
  canvasLabels: ReadonlySet<string>,
): TranscriptToken[] {
  const tokens: TranscriptToken[] = [];
  // Absolute indices stay stable when a pending word commits.
  let index = 0;

  for (const raw of tokenize(committed)) {
    const normalized = normalizeToken(raw);
    // Graph words stay redacted until their sphere is on the canvas.
    const redacted = normalized !== null && !canvasLabels.has(normalized);
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
}) {
  const [phase, setPhase] = useState<BlockPhase>(() => {
    const cached = phaseCache.get(tokenKey);
    if (cached !== undefined) {
      return cached;
    }
    return redacted ? (prefersReducedMotion() ? "hold" : "enter") : "clear";
  });
  const prevRedactedRef = useRef(redacted);
  const elementRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    phaseCache.set(tokenKey, phase);
  }, [phase, phaseCache, tokenKey]);

  useLayoutEffect(() => {
    const wasRedacted = prevRedactedRef.current;
    prevRedactedRef.current = redacted;

    if (wasRedacted === redacted) {
      return;
    }

    if (prefersReducedMotion()) {
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
  canvasLabels,
  focusedLabel,
  listening,
  ready,
  mediaStream,
  onToggleListen,
  onPasteTranscript,
  onTrySample,
  onActivateLabel,
  onSelectLabel,
  onUserScrollActivity,
  onCursorLockRelease,
  activationSinkRef,
  scrollToLabelRef,
  focusAnchorGetterRef,
  releaseCursorLockRef,
}: {
  committed: string;
  pending: string;
  canvasLabels: ReadonlySet<string>;
  focusedLabel: string | null;
  listening: boolean;
  ready: boolean;
  mediaStream: MediaStream | null;
  onToggleListen: () => void;
  onPasteTranscript: (text: string) => void;
  onTrySample: () => void;
  onActivateLabel: (label: string) => void;
  onSelectLabel: (label: string) => void;
  /** User scrolled the strip — pauses ambient idle tour. */
  onUserScrollActivity?: () => void;
  /** Pointer cleared a transcript cursor lock — pause idle tour. */
  onCursorLockRelease?: () => void;
  activationSinkRef: MutableRefObject<
    ((activations: ReadonlyMap<string, number>) => void) | null
  >;
  scrollToLabelRef: MutableRefObject<
    ((label: string, options?: { lockCursor?: boolean }) => void) | null
  >;
  /** Lets the custom cursor outline the keyboard-focused transcript word. */
  focusAnchorGetterRef: MutableRefObject<(() => HTMLElement | null) | null>;
  /** Imperative unlock (e.g. idle tour stopped). */
  releaseCursorLockRef?: MutableRefObject<(() => void) | null>;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement | null>(null);
  const phaseCacheRef = useRef(new Map<string, BlockPhase>());
  const prevTokenCountRef = useRef(0);
  const hoveredLabelRef = useRef<string | null>(null);
  /**
   * Which transcript occurrence is focused. Index (not just label) matters
   * because the strip is virtualized and the same word can appear twice.
   */
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const focusedIndexRef = useRef<number | null>(null);
  focusedIndexRef.current = focusedIndex;
  /** After arrow-key nav, lock the custom cursor onto that word until pointer moves. */
  const cursorFocusLockRef = useRef(false);
  /** First pointer sample after a lock — used so tiny jitter doesn't unlock. */
  const cursorLockOriginRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * User scrolled away from the focused word — like canvas userOverride.
   * After idle, we ease back to the focused occurrence.
   */
  const userScrollOverrideRef = useRef(false);
  const lastUserScrollAtRef = useRef(0);
  /** Ignore scroll events until this timestamp (programmatic scrollToIndex). */
  const programmaticScrollUntilRef = useRef(0);
  const wordElsRef = useRef(new Map<string, Set<HTMLElement>>());
  const activationsRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [draft, setDraft] = useState("");
  const tokens = buildTokens(committed, pending, canvasLabels);
  const hasTranscript = tokens.length > 0;

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
    overscan: 12,
    getItemKey: (index) => tokens[index]?.key ?? index,
  });

  const markUserScroll = useEffectEvent(() => {
    userScrollOverrideRef.current = true;
    lastUserScrollAtRef.current = performance.now();
    onUserScrollActivity?.();
  });

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

  const scrollToLabel = useEffectEvent(
    (label: string, options?: { lockCursor?: boolean }) => {
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
      setFocusedIndex(index);
      if (options?.lockCursor) {
        cursorFocusLockRef.current = true;
        cursorLockOriginRef.current = null;
      }
      scrollToTokenIndex(index, {
        align: "center",
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

      setFocusedIndex(index);
      cursorFocusLockRef.current = true;
      cursorLockOriginRef.current = null;
      onSelectLabel(label);
      // Single taps ease; held-key repeat stays instant so scrubbing doesn't
      // stack smooth scrolls across unmeasured virtual ranges.
      const behavior =
        options?.repeat || prefersReducedMotion() ? "auto" : "smooth";
      scrollToTokenIndex(index, { align: "center", behavior });
    },
  );

  useEffect(() => {
    focusAnchorGetterRef.current = () => {
      if (!cursorFocusLockRef.current) {
        return null;
      }
      const index = focusedIndexRef.current;
      if (index === null) {
        return null;
      }
      return document.querySelector<HTMLElement>(
        `.transcript-word[data-index="${index}"]`,
      );
    };
    return () => {
      if (focusAnchorGetterRef.current) {
        focusAnchorGetterRef.current = null;
      }
    };
  }, [focusAnchorGetterRef]);

  useEffect(() => {
    if (!hasTranscript) {
      setFocusedIndex(null);
      cursorFocusLockRef.current = false;
      cursorLockOriginRef.current = null;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
        )
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
  }, [hasTranscript]);

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
      // Keep idle-tour / transient cursor locks; only clear when unlocked.
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
  }, [focusedLabel, committed, pending, canvasLabels]);

  useEffect(() => {
    scrollToLabelRef.current = scrollToLabel;
    return () => {
      if (scrollToLabelRef.current === scrollToLabel) {
        scrollToLabelRef.current = null;
      }
    };
  }, [scrollToLabelRef]);

  useEffect(() => {
    if (tokens.length === 0) {
      return;
    }
    // Don't yank the strip to the live edge while inspecting a word.
    if (focusedLabel !== null || focusedIndexRef.current !== null) {
      return;
    }
    programmaticScrollUntilRef.current = performance.now() + 120;
    virtualizer.scrollToIndex(tokens.length - 1, { align: "end" });
  }, [committed, pending, canvasLabels, tokens.length, virtualizer, focusedLabel]);

  // Free-scroll the strip; after idle, ease back to the focused word
  // (mirrors canvas CAMERA_FOLLOW.idleReturnMs).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !hasTranscript) {
      return;
    }

    const onWheel = () => {
      markUserScroll();
    };
    const onTouchMove = () => {
      markUserScroll();
    };
    const onScroll = () => {
      // Smooth programmatic scrolls emit many events; keep the guard alive
      // until they settle so idle-tour / focus chase don't look like user input.
      if (performance.now() < programmaticScrollUntilRef.current) {
        programmaticScrollUntilRef.current = performance.now() + 200;
        return;
      }
      markUserScroll();
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });

    const idleTimer = window.setInterval(() => {
      if (!userScrollOverrideRef.current) {
        return;
      }
      const index = focusedIndexRef.current;
      if (index === null) {
        userScrollOverrideRef.current = false;
        return;
      }
      const idleMs = performance.now() - lastUserScrollAtRef.current;
      if (idleMs < CAMERA_FOLLOW.idleReturnMs) {
        return;
      }
      scrollToTokenIndex(index, {
        align: "center",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }, 200);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
      window.clearInterval(idleTimer);
    };
  }, [hasTranscript]);

  useEffect(() => {
    if (hasTranscript || listening) {
      return;
    }
    pasteRef.current?.focus();
  }, [hasTranscript, listening]);

  const submitDraft = useEffectEvent(() => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    onPasteTranscript(text);
    setDraft("");
  });

  const showEntry = !hasTranscript && !listening;

  if (showEntry) {
    return (
      <aside className="transcript-panel is-entry">
        <div className="transcript-entry">
          <header className="transcript-entry-intro">
            <h1 className="transcript-entry-brand">Thoughtfield</h1>
            <p className="transcript-entry-blurb">{THOUGHTFIELD_BLURB}</p>
          </header>
          <div className="transcript-paste-field">
            <textarea
              ref={pasteRef}
              className="transcript-paste"
              value={draft}
              rows={3}
              placeholder="Start writing — or just begin thinking out loud…"
              spellCheck={false}
              aria-label="Start writing"
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
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  submitDraft();
                }
              }}
            />
            <div className="transcript-entry-actions">
              <HudTooltip
                text="Try an example conversation"
                preferredPlacement="above"
              >
                <button
                  type="button"
                  className="transcript-try-sample"
                  onClick={onTrySample}
                >
                  Preview
                </button>
              </HudTooltip>
              {draft.trim() ? (
                <HudTooltip
                  text="Submit transcript"
                  preferredPlacement="above"
                >
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
                </HudTooltip>
              ) : (
                <HudTooltip
                  text="Start recording"
                  preferredPlacement="above"
                >
                  <button
                    type="button"
                    className="transcript-entry-action"
                    disabled={!ready}
                    aria-label="Start recording"
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
                </HudTooltip>
              )}
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={`transcript-panel${hasTranscript ? "" : " is-empty"}`}
    >
      <div className="transcript-toolbar">
        <RecordButton
          listening={listening}
          ready={ready}
          stream={mediaStream}
          onToggle={onToggleListen}
        />
      </div>
      {hasTranscript ? (
        <div className="transcript-body" ref={bodyRef}>
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
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
