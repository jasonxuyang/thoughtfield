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

  it("lemmatizes common forms via wink", () => {
    expect(normalizeToken("browsers")).toBe("browser");
    expect(normalizeToken("running")).toBe("run");
    expect(normalizeToken("related")).toBe("relate");
    expect(normalizeToken("created")).toBe("create");
    expect(normalizeToken("walked")).toBe("walk");
    expect(normalizeToken("waited")).toBe("wait");
    expect(normalizeToken("hiding")).toBe("hide");
    expect(normalizeToken("waiting")).toBe("wait");
  });

  it("does not invent broken silent-e stems", () => {
    expect(normalizeToken("waited")).not.toBe("waite");
    expect(normalizeToken("hiding")).not.toBe("hidin");
    expect(normalizeToken("hiding")).not.toBe("hid");
  });

  it("expands colloquial g-drop when the -ing form is known", () => {
    expect(normalizeToken("hidin")).toBe("hide");
    expect(normalizeToken("hidin'")).toBe("hide");
    expect(normalizeToken("talkin")).toBe("talk");
    expect(normalizeToken("goin")).toBe("go");
  });

  it("does not g-drop real *in nouns", () => {
    expect(normalizeToken("cabin")).toBe("cabin");
    expect(normalizeToken("muffin")).toBe("muffin");
  });

  it("canonicalizes technology terms", () => {
    expect(normalizeToken("WebGPU")).toBe("webgpu");
    expect(normalizeTranscriptWords("Web GPU rocks")[0]?.normalized).toBe(
      "webgpu",
    );
  });

  it("keeps sung colloquialisms wink would mangle", () => {
    expect(normalizeToken("shinin'")).toBe("shine");
    expect(normalizeToken("shining")).toBe("shine");
    expect(normalizeToken("born")).toBe("born");
  });

  it("preserves Hangul surface forms", () => {
    expect(normalizeToken("영원히")).toBe("영원히");
    expect(normalizeToken("빛나는")).toBe("빛나는");
  });

  it("rejects numeric-only and empty tokens", () => {
    expect(normalizeToken("42")).toBeNull();
    expect(normalizeToken("...")).toBeNull();
  });
});
