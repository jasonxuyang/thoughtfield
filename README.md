# Thoughtfield

### Speak, and watch your thoughts take shape.

[![Live](https://img.shields.io/badge/Live-try%20Thoughtfield-blue.svg)](https://thoughtfield.jasonxuyang.com)
[![Local](https://img.shields.io/badge/Local--first-runs%20in%20your%20browser-8b5cf6.svg)](#what-is-happening-locally)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Thoughtfield turns your thoughts into a living map of language.** As you talk—or paste in text—Whisper transcribes locally, embeddings connect related words, and a graph takes shape in real time. Everything runs in your browser, so your voice and transcript stay on your device.

[Try it](https://thoughtfield.jasonxuyang.com) · [How to use it](#using-it) · [How it works](#what-is-happening-locally)

---

## Using it

Start with your voice, your words, or a sample:

| Action | What happens |
| --- | --- |
| **Mic** | Speak naturally and watch words enter the field |
| **Type or paste**, then **Space** / **Enter** | Build a graph from existing text |
| **Preview** | Load a sample and watch the field come alive |

As language arrives, related words pull together into communities. Connections strengthen, ideas resurface, and activation moves across the graph. Select any node to explore its context, or clear the session to begin with an empty field.

Your transcript and graph are saved in your browser's IndexedDB. Nothing is uploaded or synced between devices.

## What is happening locally

| Listen | Embed | Animate |
| --- | --- | --- |
| **Speech + text** | **Whisper + MiniLM in Web Workers** | **A living PixiJS graph** |
| Speak into the mic or paste a transcript. Audio and text stay on-device. | [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) handles transcription and semantic embeddings in the browser. | Semantic similarity and word proximity form connections; communities and activation bring the field to life. |

The models download once and are cached for later visits. Transcription and embedding run in Web Workers, keeping inference off the main UI thread.

```text
voice / text                         Web Workers
────────────                         ───────────
audio / text ──── postMessage ─────▶ Whisper + MiniLM
transcript + vectors ◀────────────── on-device inference
living graph ◀──── semantic + colocation links
```

## License

[MIT](LICENSE)
