/**
 * LocalAgreement-style commit policy adapted from realtime-captions /
 * ufal/whisper_streaming: when the same hypothesis repeats across consecutive
 * inference passes, treat it as stable and archive it.
 */

export type AgreementState = {
  archive: string[];
  tempOutput: string;
  prevOutput: string;
  agreementStreak: number;
  /** Sample index into the cumulative decoded buffer where pending audio starts. */
  cutSample: number;
};

export function createAgreementState(): AgreementState {
  return {
    archive: [],
    tempOutput: "",
    prevOutput: "",
    agreementStreak: 0,
    cutSample: 0,
  };
}

export type AgreementResult = {
  state: AgreementState;
  /** Segment just moved into the archive, if any. */
  newlyCommitted: string | null;
};

/**
 * Apply one completed Whisper hypothesis for the current pending audio window.
 *
 * @param agreementThreshold - consecutive identical outputs required to commit
 *   (realtime-captions uses 3)
 */
export function applyLocalAgreement(
  state: AgreementState,
  output: string,
  audioLengthSamples: number,
  agreementThreshold: number,
): AgreementResult {
  const trimmed = output.trim();
  if (!trimmed) {
    return {
      state: {
        ...state,
        tempOutput: "",
      },
      newlyCommitted: null,
    };
  }

  if (trimmed === state.prevOutput) {
    const streak = state.agreementStreak + 1;
    if (streak >= agreementThreshold) {
      return {
        state: {
          archive: [...state.archive, trimmed],
          tempOutput: "",
          prevOutput: "",
          agreementStreak: 0,
          cutSample: audioLengthSamples,
        },
        newlyCommitted: trimmed,
      };
    }

    return {
      state: {
        ...state,
        tempOutput: trimmed,
        agreementStreak: streak,
      },
      newlyCommitted: null,
    };
  }

  return {
    state: {
      ...state,
      tempOutput: trimmed,
      prevOutput: trimmed,
      agreementStreak: 1,
    },
    newlyCommitted: null,
  };
}

/** Flush any remaining pending hypothesis when listening stops. */
export function flushAgreement(state: AgreementState): AgreementResult {
  const pending = state.tempOutput.trim();
  if (!pending) {
    return {
      state: {
        ...state,
        tempOutput: "",
        prevOutput: "",
        agreementStreak: 0,
      },
      newlyCommitted: null,
    };
  }

  return {
    state: {
      archive: [...state.archive, pending],
      tempOutput: "",
      prevOutput: "",
      agreementStreak: 0,
      cutSample: state.cutSample,
    },
    newlyCommitted: pending,
  };
}

export function committedText(state: AgreementState): string {
  return state.archive.filter(Boolean).join(" ");
}
