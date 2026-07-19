import { describe, expect, it } from "vitest";
import { PcmQueue } from "../audio/pcm-buffer";

describe("PcmQueue", () => {
  it("takes contiguous samples across pushed chunks", () => {
    const queue = new PcmQueue();
    queue.push(new Float32Array([1, 2, 3]));
    queue.push(new Float32Array([4, 5]));
    expect(queue.length).toBe(5);

    const first = queue.take(4);
    expect(first).not.toBeNull();
    expect([...first!]).toEqual([1, 2, 3, 4]);
    expect(queue.length).toBe(1);

    const rest = queue.takeAll();
    expect([...rest]).toEqual([5]);
    expect(queue.length).toBe(0);
  });

  it("returns null when not enough samples", () => {
    const queue = new PcmQueue();
    queue.push(new Float32Array([1, 2]));
    expect(queue.take(3)).toBeNull();
    expect(queue.length).toBe(2);
  });
});
