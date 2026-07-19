# Thoughtfield

English-only local web app that listens to microphone audio, transcribes speech in the browser with Whisper, builds a personalized semantic–colocation word graph, and renders floating word nodes with PixiJS.

## Stack

- Vite + React + TypeScript
- PixiJS (canvas rendering)
- `@huggingface/transformers` (Whisper tiny.en + MiniLM embeddings)
- Graphology + Louvain communities
- IndexedDB persistence
- Web Workers + AudioWorklet

All transcription, embeddings, graph math, storage, and rendering stay on-device. No transcript or audio is sent to a backend.

## Develop

```bash
npm install
npm run dev
```

Open the local URL, wait for ASR and embedding models to finish loading, then click **Start listening**.

## Test

```bash
npm test
```

## Build

```bash
npm run build
npm run preview
```

COOP/COEP headers are enabled in Vite so WASM / WebGPU model paths can use cross-origin isolation.
