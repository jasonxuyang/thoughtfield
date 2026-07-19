import { BitmapFont } from "pixi.js";

/** Shared atlas for sphere + strand letters (Latin word graph). */
export const LETTER_BITMAP_FONT = "ThoughtfieldLetters";

let installed = false;
let installPromise: Promise<void> | null = null;

/**
 * Install once after Space Mono is available. BitmapText draws from this
 * atlas instead of rasterizing a canvas texture per glyph.
 */
export async function ensureLetterBitmapFont(): Promise<void> {
  if (installed) {
    return;
  }
  if (installPromise) {
    await installPromise;
    return;
  }

  installPromise = (async () => {
    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.load('400 48px "Space Mono"');
    }

    BitmapFont.install({
      name: LETTER_BITMAP_FONT,
      style: {
        fontFamily: '"Space Mono", ui-monospace, monospace',
        fontSize: 48,
        fill: "#ffffff",
        fontWeight: "400",
      },
      chars: [
        ["a", "z"],
        ["0", "9"],
        "-",
        "'",
        "·",
      ],
      resolution: 2,
      padding: 3,
    });
    installed = true;
  })();

  await installPromise;
}
