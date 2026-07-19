import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SITE_TITLE } from "./site";
import "./index.css";

document.title = SITE_TITLE;

/** Trackpad pinch is ctrl/meta+wheel — block page zoom so the canvas can own it. */
function preventBrowserZoom(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
  }
}

/** Safari still fires gesture* for pinch page-zoom. */
function preventGestureZoom(event: Event): void {
  event.preventDefault();
}

document.addEventListener("wheel", preventBrowserZoom, {
  passive: false,
  capture: true,
});
document.addEventListener("gesturestart", preventGestureZoom, {
  passive: false,
});
document.addEventListener("gesturechange", preventGestureZoom, {
  passive: false,
});
document.addEventListener("gestureend", preventGestureZoom, {
  passive: false,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
