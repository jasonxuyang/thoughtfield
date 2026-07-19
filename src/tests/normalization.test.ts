import { describe, expect, it } from "vitest";
import {
  normalizeToken,
  normalizeTranscriptWords,
} from "../transcription/normalization";

describe("normalization", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeToken("Models!")).toBe("model");
  });

  it("removes fillers and stop words", () => {
    expect(normalizeToken("um")).toBeNull();
    expect(normalizeToken("the")).toBeNull();
    expect(normalizeToken("basically")).toBeNull();
  });

  it("keeps negation words", () => {
    expect(normalizeToken("not")).toBe("not");
    expect(normalizeToken("never")).toBe("never");
    expect(normalizeToken("without")).toBe("without");
  });

  it("lemmatizes common forms", () => {
    expect(normalizeToken("browsers")).toBe("browser");
    expect(normalizeToken("running")).toBe("run");
    expect(normalizeToken("related")).toBe("relate");
    expect(normalizeToken("created")).toBe("create");
    expect(normalizeToken("walked")).toBe("walk");
  });

  it("canonicalizes technology terms", () => {
    expect(normalizeToken("WebGPU")).toBe("webgpu");
    expect(normalizeTranscriptWords("Web GPU rocks")[0]?.normalized).toBe(
      "webgpu",
    );
  });

  it("rejects numeric-only and empty tokens", () => {
    expect(normalizeToken("42")).toBeNull();
    expect(normalizeToken("...")).toBeNull();
  });
});
