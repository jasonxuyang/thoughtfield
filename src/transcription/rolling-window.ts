import type { TranscriptWord } from "./stable-prefix";

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function wordsMatch(a: string, b: string): boolean {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  return left.length > 0 && left === right;
}

/**
 * Longest k such that prev.slice(-k) matches next.slice(0, k)
 * using punctuation-insensitive comparison.
 */
export function windowOverlap(prev: string[], next: string[]): number {
  const maxK = Math.min(prev.length, next.length);
  for (let k = maxK; k > 0; k -= 1) {
    let ok = true;
    for (let i = 0; i < k; i += 1) {
      if (!wordsMatch(prev[prev.length - k + i]!, next[i]!)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return k;
    }
  }
  return 0;
}

export type WindowReconcileResult = {
  /** Words that left the rolling window and can be finalized. */
  scrolledOut: string[];
  /** Replacement for the previous window hypothesis. */
  nextWindow: string[];
};

/**
 * Reconcile consecutive rolling-window transcripts.
 *
 * Only finalize words that clearly scrolled out of the previous window.
 * If Whisper rewrites the hypothesis so nothing overlaps, commit nothing
 * and replace the live window — matching the HF demo's replace behavior
 * instead of appending duplicates.
 */
export function reconcileRollingWindows(
  previousWindow: string[],
  currentWindow: string[],
): WindowReconcileResult {
  if (currentWindow.length === 0) {
    return { scrolledOut: [], nextWindow: previousWindow };
  }

  if (previousWindow.length === 0) {
    return { scrolledOut: [], nextWindow: currentWindow };
  }

  const overlap = windowOverlap(previousWindow, currentWindow);
  if (overlap === 0) {
    // Unstable rewrite — do not grow the session from a bad alignment.
    return { scrolledOut: [], nextWindow: currentWindow };
  }

  return {
    scrolledOut: previousWindow.slice(0, previousWindow.length - overlap),
    nextWindow: currentWindow,
  };
}

export function toTranscriptWords(texts: string[]): TranscriptWord[] {
  return texts.map((text) => ({ text }));
}
