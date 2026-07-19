/**
 * One-shot: record a short Preview demo for the README.
 * Requires: dev server on :5173, playwright + chromium, ffmpeg.
 */
import { chromium } from "playwright";
import { mkdir, readdir, unlink, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public");
const tmpDir = path.join(root, ".demo-record");
const gifPath = path.join(outDir, "demo.gif");
const mp4Path = path.join(outDir, "demo.mp4");

await rm(tmpDir, { recursive: true, force: true });
await mkdir(tmpDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-angle=metal",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
  ],
});

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: tmpDir,
    size: { width: 1280, height: 800 },
  },
});

const page = await context.newPage();

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });

// Fresh session — entry preview, not a restored graph.
await page.evaluate(async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("thoughtfield");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("idb delete failed"));
    req.onblocked = () => resolve();
  });
});
await page.reload({ waitUntil: "domcontentloaded" });

// Boot overlay stays mounted; wait until the visible class drops.
await page.waitForFunction(
  () => !document.querySelector(".boot-screen.is-visible"),
  { timeout: 180_000 },
);
await page.getByRole("button", { name: "Preview" }).waitFor({
  state: "visible",
  timeout: 30_000,
});

// Entry screen + ambient field.
await page.waitForTimeout(4500);

await page.getByRole("button", { name: "Preview" }).click();
await page.waitForTimeout(11_000);

const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
if (box) {
  const x = box.x + box.width * 0.52;
  const y = box.y + box.height * 0.48;
  await page.mouse.move(x, y);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(x - 90, y + 35, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(2800);
}

await context.close();
await browser.close();

const videos = (await readdir(tmpDir)).filter((f) => f.endsWith(".webm"));
if (videos.length === 0) {
  throw new Error("No Playwright video written");
}
const webm = path.join(tmpDir, videos[0]);

// Drop the boot overlay from the start of the capture.
const trimStartSec = "4";

const mp4 = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    trimStartSec,
    "-i",
    webm,
    "-vf",
    "scale=1280:-2:flags=lanczos",
    "-c:v",
    "libx264",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    mp4Path,
  ],
  { stdio: "inherit" },
);
if (mp4.status !== 0) {
  throw new Error("ffmpeg mp4 failed");
}

// Compact looping GIF for GitHub README autoplay.
const gif = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-ss",
    trimStartSec,
    "-i",
    webm,
    "-vf",
    "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop",
    "0",
    gifPath,
  ],
  { stdio: "inherit" },
);
if (gif.status !== 0) {
  throw new Error("ffmpeg gif failed");
}

await unlink(webm).catch(() => {});
console.log("Wrote", gifPath);
console.log("Wrote", mp4Path);
