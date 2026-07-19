import { describe, expect, it } from "vitest";
import {
  applyLocalAgreement,
  committedText,
  createAgreementState,
  flushAgreement,
} from "../transcription/local-agreement";

describe("local agreement", () => {
  it("keeps changing hypotheses in the pending buffer", () => {
    let state = createAgreementState();
    let result = applyLocalAgreement(state, "hello world", 16000, 3);
    state = result.state;
    expect(result.newlyCommitted).toBeNull();
    expect(state.tempOutput).toBe("hello world");

    result = applyLocalAgreement(state, "hello there", 32000, 3);
    state = result.state;
    expect(result.newlyCommitted).toBeNull();
    expect(state.tempOutput).toBe("hello there");
    expect(state.archive).toEqual([]);
  });

  it("commits after enough identical hypotheses", () => {
    let state = createAgreementState();

    for (let i = 0; i < 2; i += 1) {
      const result = applyLocalAgreement(state, "hello world", 16000, 3);
      state = result.state;
      expect(result.newlyCommitted).toBeNull();
    }

    const committed = applyLocalAgreement(state, "hello world", 48000, 3);
    expect(committed.newlyCommitted).toBe("hello world");
    expect(committed.state.archive).toEqual(["hello world"]);
    expect(committed.state.tempOutput).toBe("");
    expect(committed.state.cutSample).toBe(48000);
    expect(committedText(committed.state)).toBe("hello world");
  });

  it("flushes pending text on stop", () => {
    let state = createAgreementState();
    state = applyLocalAgreement(state, "partial line", 8000, 3).state;
    const flushed = flushAgreement(state);
    expect(flushed.newlyCommitted).toBe("partial line");
    expect(committedText(flushed.state)).toBe("partial line");
  });
});
