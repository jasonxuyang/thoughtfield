import type { CommittedWord } from "../graph/graph-types";

/** Pace the canned demo like spoken input so activation can be watched. */
export const DEMO_STREAM_CONFIG = {
  /** Words committed (and sent to the graph) per tick. */
  wordsPerTick: 1,
  /** Delay between spoken words. */
  intervalMs: 340,
  /** Brief pause before the first word. */
  startDelayMs: 700,
  /** How many upcoming words to show as live/pending ASR. */
  pendingLookahead: 2,
};

export type DemoStreamTick = {
  /** Newly committed words this tick (for the graph). */
  words: CommittedWord[];
  /** Full committed transcript so far. */
  committed: string;
  /** Upcoming words shown as live partial text. */
  pending: string;
  /** True after the final word has been committed. */
  done: boolean;
};

export type DemoStreamOptions = {
  words: CommittedWord[];
  onTick: (tick: DemoStreamTick) => void;
  wordsPerTick?: number;
  intervalMs?: number;
  startDelayMs?: number;
  pendingLookahead?: number;
};

/**
 * Streams a prepared word list as if speech were being committed over time.
 * Updates transcript text and graph ingest together on each tick.
 */
export class DemoTranscriptStream {
  private readonly words: CommittedWord[];
  private readonly onTick: (tick: DemoStreamTick) => void;
  private readonly wordsPerTick: number;
  private readonly intervalMs: number;
  private readonly startDelayMs: number;
  private readonly pendingLookahead: number;
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: DemoStreamOptions) {
    this.words = options.words;
    this.onTick = options.onTick;
    this.wordsPerTick = Math.max(
      1,
      options.wordsPerTick ?? DEMO_STREAM_CONFIG.wordsPerTick,
    );
    this.intervalMs = Math.max(
      16,
      options.intervalMs ?? DEMO_STREAM_CONFIG.intervalMs,
    );
    this.startDelayMs = Math.max(
      0,
      options.startDelayMs ?? DEMO_STREAM_CONFIG.startDelayMs,
    );
    this.pendingLookahead = Math.max(
      0,
      options.pendingLookahead ?? DEMO_STREAM_CONFIG.pendingLookahead,
    );
  }

  start(): void {
    if (this.stopped || this.words.length === 0) {
      this.onTick({
        words: [],
        committed: "",
        pending: "",
        done: true,
      });
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, this.startDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private step(): void {
    if (this.stopped) {
      return;
    }

    const next = this.words.slice(this.index, this.index + this.wordsPerTick);
    this.index += next.length;

    const committed = this.words
      .slice(0, this.index)
      .map((word) => word.rawText)
      .join(" ");
    const pending = this.words
      .slice(this.index, this.index + this.pendingLookahead)
      .map((word) => word.rawText)
      .join(" ");
    const done = this.index >= this.words.length;

    this.onTick({
      words: next,
      committed,
      pending,
      done,
    });

    if (!done) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.step();
      }, this.intervalMs);
    }
  }
}
