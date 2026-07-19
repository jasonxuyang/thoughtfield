import type { CommittedWord } from "../graph/graph-types";

export type IngestQueueOptions = {
  /** Words released per tick. */
  batchSize?: number;
  /** Delay between batches in ms. */
  intervalMs?: number;
  onBatch: (words: CommittedWord[]) => void;
};

/**
 * Paces committed-word delivery so a large seed (or burst) cannot flood
 * the graph worker, embedding pipeline, and renderer in one frame.
 */
export class CommittedWordIngestQueue {
  private queue: CommittedWord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly onBatch: (words: CommittedWord[]) => void;
  private stopped = false;

  constructor(options: IngestQueueOptions) {
    this.batchSize = Math.max(1, options.batchSize ?? 2);
    this.intervalMs = Math.max(16, options.intervalMs ?? 140);
    this.onBatch = options.onBatch;
  }

  enqueue(words: CommittedWord[]): void {
    if (this.stopped || words.length === 0) {
      return;
    }
    const wasIdle = this.queue.length === 0 && this.timer === null;
    this.queue.push(...words);
    // Start immediately when idle; later batches keep the paced interval.
    this.schedule(wasIdle);
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private schedule(immediate = false): void {
    if (this.stopped || this.timer !== null || this.queue.length === 0) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushBatch();
    }, immediate ? 0 : this.intervalMs);
  }

  private flushBatch(): void {
    if (this.stopped || this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    this.onBatch(batch);

    if (this.queue.length > 0) {
      this.schedule(false);
    }
  }
}
