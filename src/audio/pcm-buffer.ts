export class PcmRingBuffer {
  private buffer: Float32Array;
  private writeIndex = 0;
  private available = 0;

  constructor(capacitySamples: number) {
    this.buffer = new Float32Array(capacitySamples);
  }

  get capacity(): number {
    return this.buffer.length;
  }

  get length(): number {
    return this.available;
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i += 1) {
      this.buffer[this.writeIndex] = samples[i]!;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.available = Math.min(this.available + 1, this.buffer.length);
    }
  }

  /**
   * Return the most recent `count` samples without removing them.
   */
  peekLast(count: number): Float32Array {
    const n = Math.min(count, this.available);
    const result = new Float32Array(n);
    let index =
      (this.writeIndex - n + this.buffer.length) % this.buffer.length;
    for (let i = 0; i < n; i += 1) {
      result[i] = this.buffer[index]!;
      index = (index + 1) % this.buffer.length;
    }
    return result;
  }

  clear(): void {
    this.writeIndex = 0;
    this.available = 0;
    this.buffer.fill(0);
  }
}

/**
 * FIFO PCM queue: push mic samples, take contiguous chunks exactly once.
 */
export class PcmQueue {
  private chunks: Float32Array[] = [];
  private buffered = 0;

  get length(): number {
    return this.buffered;
  }

  push(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }
    this.chunks.push(new Float32Array(samples));
    this.buffered += samples.length;
  }

  /**
   * Remove and return the next `count` samples, or null if not enough yet.
   */
  take(count: number): Float32Array | null {
    if (count <= 0 || this.buffered < count) {
      return null;
    }

    const result = new Float32Array(count);
    let offset = 0;

    while (offset < count) {
      const head = this.chunks[0]!;
      const need = count - offset;

      if (head.length <= need) {
        result.set(head, offset);
        offset += head.length;
        this.chunks.shift();
      } else {
        result.set(head.subarray(0, need), offset);
        this.chunks[0] = head.subarray(need);
        offset += need;
      }
    }

    this.buffered -= count;
    return result;
  }

  /**
   * Take whatever is buffered (for final flush).
   */
  takeAll(): Float32Array {
    if (this.buffered === 0) {
      return new Float32Array(0);
    }
    const result = this.take(this.buffered);
    return result ?? new Float32Array(0);
  }

  clear(): void {
    this.chunks = [];
    this.buffered = 0;
  }
}

/**
 * Linear resample from sourceRate to targetRate.
 */
export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) {
    return new Float32Array(input);
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const srcIndex = i * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcIndex - left;
    output[i] = input[left]! * (1 - frac) + input[right]! * frac;
  }

  return output;
}
