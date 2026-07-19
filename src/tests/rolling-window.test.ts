import { describe, expect, it } from "vitest";
import {
  reconcileRollingWindows,
  windowOverlap,
} from "../transcription/rolling-window";

describe("rolling window reconcile", () => {
  it("detects overlap ignoring punctuation/case", () => {
    expect(
      windowOverlap(
        ["Hello", "World."],
        ["hello", "world", "again"],
      ),
    ).toBe(2);
  });

  it("commits only scrolled-out words", () => {
    const result = reconcileRollingWindows(
      ["hello", "world", "foo", "bar"],
      ["world", "foo", "bar", "baz"],
    );
    expect(result.scrolledOut).toEqual(["hello"]);
    expect(result.nextWindow).toEqual(["world", "foo", "bar", "baz"]);
  });

  it("does not append when Whisper fully rewrites the hypothesis", () => {
    const result = reconcileRollingWindows(
      ["Test", "123", "hello", "world"],
      ["Test", "one", "two", "three", "hello", "world", "Jason"],
    );
    // Poor overlap on the prefix → treat as rewrite, commit nothing.
    expect(result.scrolledOut).toEqual([]);
    expect(result.nextWindow).toEqual([
      "Test",
      "one",
      "two",
      "three",
      "hello",
      "world",
      "Jason",
    ]);
  });

  it("keeps an empty previous window from committing", () => {
    const result = reconcileRollingWindows([], ["hello", "world"]);
    expect(result.scrolledOut).toEqual([]);
    expect(result.nextWindow).toEqual(["hello", "world"]);
  });
});
