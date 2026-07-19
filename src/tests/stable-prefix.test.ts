import { describe, expect, it } from "vitest";
import {
  flushPendingWords,
  reconcileStablePrefix,
} from "../transcription/stable-prefix";

describe("stable-prefix reconciliation", () => {
  it("commits only the stable common prefix beyond prior commits", () => {
    const previous = [
      { text: "hello" },
      { text: "world" },
      { text: "foo" },
    ];
    const current = [
      { text: "hello" },
      { text: "world" },
      { text: "bar" },
    ];

    const result = reconcileStablePrefix(previous, current, 0, 1);
    expect(result.committed.map((w) => w.text)).toEqual(["hello", "world"]);
    expect(result.pending.map((w) => w.text)).toEqual(["bar"]);
  });

  it("does not re-commit already committed words", () => {
    const previous = [
      { text: "one" },
      { text: "two" },
      { text: "three" },
    ];
    const current = [
      { text: "one" },
      { text: "two" },
      { text: "three" },
      { text: "four" },
    ];

    const result = reconcileStablePrefix(previous, current, 2, 1);
    expect(result.committed.map((w) => w.text)).toEqual(["three"]);
  });

  it("flushes remaining pending words", () => {
    const words = [{ text: "a" }, { text: "b" }, { text: "c" }];
    expect(flushPendingWords(words, 1).map((w) => w.text)).toEqual([
      "b",
      "c",
    ]);
  });
});
