export type TranscriptWord = {
  text: string;
  startMs?: number;
  endMs?: number;
};

export type StablePrefixResult = {
  committed: TranscriptWord[];
  pending: TranscriptWord[];
  stableText: string;
};

export type RollingReconcileResult = {
  newlyCommitted: TranscriptWord[];
  pending: TranscriptWord[];
  committed: TranscriptWord[];
};

function wordsEqual(a: TranscriptWord, b: TranscriptWord): boolean {
  return a.text.toLowerCase() === b.text.toLowerCase();
}

/**
 * Longest k such that a.slice(-k) equals b.slice(0, k).
 */
export function longestSuffixPrefixOverlap(
  a: TranscriptWord[],
  b: TranscriptWord[],
): number {
  const maxK = Math.min(a.length, b.length);
  for (let k = maxK; k > 0; k -= 1) {
    let matches = true;
    for (let i = 0; i < k; i += 1) {
      if (!wordsEqual(a[a.length - k + i]!, b[i]!)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return k;
    }
  }
  return 0;
}

/**
 * Find the longest common prefix between consecutive ASR results and
 * commit words that have remained unchanged across inferences or have
 * moved outside the editable overlap region.
 *
 * Suitable when the ASR transcript is a growing session string.
 * Prefer {@link reconcileRollingWindow} for sliding audio windows.
 */
export function reconcileStablePrefix(
  previousWords: TranscriptWord[],
  currentWords: TranscriptWord[],
  alreadyCommittedCount: number,
  editableOverlapWordCount: number,
): StablePrefixResult {
  let commonLength = 0;
  const maxCompare = Math.min(previousWords.length, currentWords.length);

  while (
    commonLength < maxCompare &&
    wordsEqual(previousWords[commonLength]!, currentWords[commonLength]!)
  ) {
    commonLength += 1;
  }

  const commitUntil = Math.max(
    alreadyCommittedCount,
    Math.min(
      commonLength,
      Math.max(0, currentWords.length - editableOverlapWordCount),
    ),
  );

  const committed = currentWords.slice(alreadyCommittedCount, commitUntil);
  const pending = currentWords.slice(commitUntil);
  const stableText = currentWords
    .slice(0, commitUntil)
    .map((word) => word.text)
    .join(" ");

  return { committed, pending, stableText };
}

/**
 * Reconcile a sliding-window ASR result against session state.
 *
 * Each Whisper call only covers recent audio, so older pending words fall
 * off the front of the window and should be committed. The trailing
 * `editableOverlapWordCount` words stay pending because Whisper may revise them.
 */
export function reconcileRollingWindow(
  committed: TranscriptWord[],
  previousPending: TranscriptWord[],
  windowWords: TranscriptWord[],
  editableOverlapWordCount: number,
): RollingReconcileResult {
  if (windowWords.length === 0) {
    return {
      newlyCommitted: [],
      pending: previousPending,
      committed,
    };
  }

  const editable = Math.max(1, editableOverlapWordCount);
  const newlyCommitted: TranscriptWord[] = [];
  const nextCommitted = [...committed];

  // 1. Commit pending words that no longer appear in the new window
  //    (they have scrolled out of the rolling audio buffer).
  const previousView = [
    ...committed.slice(-windowWords.length),
    ...previousPending,
  ];
  const overlap = longestSuffixPrefixOverlap(previousView, windowWords);
  const alignedStart = previousView.length - overlap;
  const pendingOffset = Math.max(0, previousView.length - previousPending.length);

  if (alignedStart > pendingOffset) {
    const dropCount = alignedStart - pendingOffset;
    for (const word of previousPending.slice(0, dropCount)) {
      newlyCommitted.push(word);
      nextCommitted.push(word);
    }
  } else if (overlap === 0 && previousPending.length > 0) {
    // No alignment — treat prior pending as finalized before accepting the new window.
    for (const word of previousPending) {
      newlyCommitted.push(word);
      nextCommitted.push(word);
    }
  }

  // 2. Advance commitment through the non-editable head of the window.
  const covered = longestSuffixPrefixOverlap(nextCommitted, windowWords);
  const commitUntil = Math.max(covered, Math.max(0, windowWords.length - editable));

  for (let i = covered; i < commitUntil; i += 1) {
    const word = windowWords[i]!;
    newlyCommitted.push(word);
    nextCommitted.push(word);
  }

  // 3. Pending = uncommitted tail of the current window.
  const pendingStart = Math.max(
    longestSuffixPrefixOverlap(nextCommitted, windowWords),
    commitUntil,
  );

  return {
    newlyCommitted,
    pending: windowWords.slice(pendingStart),
    committed: nextCommitted,
  };
}

/**
 * Commit any remaining pending words when listening stops.
 */
export function flushPendingWords(
  currentWords: TranscriptWord[],
  alreadyCommittedCount: number,
): TranscriptWord[] {
  return currentWords.slice(alreadyCommittedCount);
}

export function flushPendingList(pending: TranscriptWord[]): TranscriptWord[] {
  return [...pending];
}
