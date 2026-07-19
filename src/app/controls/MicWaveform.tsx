import { useEffect, useRef } from "react";

type MicWaveformProps = {
  stream: MediaStream | null;
  active: boolean;
};

const BAR_COUNT = 3;
const BAR_WIDTH = 4.25;
const BAR_GAP = 2.75;
const MIN_BAR = 0.16;
const SENSITIVITY = 1.85;
const CSS_HEIGHT = 22;
/** How quickly bars chase the live level (1 = instant). */
const ATTACK = 0.72;
/** How quickly bars fall when quiet. */
const RELEASE = 0.38;

/**
 * Compact 3-bar Meet-style level meter.
 * Reuses the ASR MediaStream instead of opening a second getUserMedia.
 */
export function MicWaveform({ stream, active }: MicWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const barsRef = useRef<number[]>(Array.from({ length: BAR_COUNT }, () => MIN_BAR));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(CSS_HEIGHT * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${CSS_HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let data: Uint8Array<ArrayBuffer> | null = null;
    let rafId = 0;
    let lastSample = 0;

    if (active && stream) {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      data = new Uint8Array(analyser.frequencyBinCount);
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      if (audioContext.state === "suspended") {
        void audioContext.resume();
      }
    }

    const draw = (time: number) => {
      if (active && analyser && data && time - lastSample > 16) {
        lastSample = time;
        analyser.getByteFrequencyData(data);

        // Three voice bands → three bars (low / mid / high).
        const start = Math.floor(data.length * 0.05);
        const end = Math.floor(data.length * 0.45);
        const band = data.subarray(start, end);
        const slice = Math.max(1, Math.floor(band.length / BAR_COUNT));
        const next: number[] = [];

        for (let i = 0; i < BAR_COUNT; i += 1) {
          const from = i * slice;
          const to = Math.min(band.length, from + slice);
          let sum = 0;
          for (let j = from; j < to; j += 1) {
            sum += band[j] ?? 0;
          }
          const average = sum / Math.max(1, to - from);
          next.push(Math.max(MIN_BAR, Math.min(1, (average / 255) * SENSITIVITY)));
        }

        const prev = barsRef.current;
        barsRef.current = next.map((value, i) => {
          const current = prev[i] ?? MIN_BAR;
          const rate = value > current ? ATTACK : RELEASE;
          return current + (value - current) * rate;
        });
      } else if (!active) {
        barsRef.current = barsRef.current.map(
          (value) => value + (MIN_BAR - value) * 0.35,
        );
      }

      ctx.clearRect(0, 0, cssWidth, CSS_HEIGHT);
      const centerY = CSS_HEIGHT / 2;
      const color = active
        ? "rgba(10, 10, 10, 0.9)"
        : "rgba(10, 10, 10, 0.28)";

      for (let i = 0; i < BAR_COUNT; i += 1) {
        const level = barsRef.current[i] ?? MIN_BAR;
        const height = Math.max(BAR_WIDTH, level * CSS_HEIGHT);
        const x = i * (BAR_WIDTH + BAR_GAP);
        const y = centerY - height / 2;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_WIDTH, height, BAR_WIDTH / 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close();
      }
    };
  }, [stream, active]);

  return (
    <canvas
      ref={canvasRef}
      className="mic-waveform"
      aria-hidden="true"
    />
  );
}
