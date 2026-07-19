import { Application, Container } from "pixi.js";
import type { AlgorithmSettings } from "../config/algorithms";
import {
  CAMERA_FOLLOW,
  DEFAULT_SETTINGS,
  OVERVIEW_CAMERA,
} from "../config/algorithms";
import type { GraphSnapshot } from "../graph/graph-types";
import {
  applyCameraTransform,
  CAMERA_PAN_LIMIT,
  CAMERA_ZOOM,
  cameraToFitBounds,
  clampCameraPan,
  clampCameraToContent,
  contentBoundsForOverview,
  createCamera,
  expandWorldBounds,
  minScaleToFitBounds,
  panCamera,
  resetCamera,
  screenToWorld,
  smoothDamp,
  worldViewportBounds,
  zoomAt,
  type CameraState,
  type SmoothVelocity,
  type WorldBounds,
} from "./camera";
import { ensureLetterBitmapFont } from "./bitmap-fonts";
import { EdgeStringDisplay } from "./edge-strings";
import { sphereRadiusForWord } from "./letter-sphere";
import { Minimap } from "./minimap";
import { DebugOverlay, WordDisplay } from "./word-display";

type ActivePointer = {
  id: number;
  x: number;
  y: number;
};

/** Screen-space slop: below this, a press does not start a pan. */
const CLICK_SLOP_PX = 8;
/** Ignore sub-pixel / camera-chase jitter when updating hover. */
const HOVER_INTENT_PX = 2;

export class PixiGraphApp {
  readonly app: Application;
  private world = new Container();
  private words = new WordDisplay();
  private edgeStrings = new EdgeStringDisplay();
  private debug = new DebugOverlay();
  private minimap = new Minimap();
  private camera: CameraState = createCamera();
  private settings: AlgorithmSettings = { ...DEFAULT_SETTINGS };
  private snapshot: GraphSnapshot | null = null;
  private pointers = new Map<number, ActivePointer>();
  private lastPanPoint = { x: 0, y: 0 };
  private pinchDistance = 0;
  private lastFrame = performance.now();
  private mounted = false;
  private destroyed = false;
  /** True while the user has pulled away from the default viewport. */
  private userOverride = false;
  private lastUserInputAt = 0;
  /** Click/select focus — ignore shared idle pause until the next pan/zoom. */
  private forceFollow = false;
  private chaseVelX: SmoothVelocity = { v: 0 };
  private chaseVelY: SmoothVelocity = { v: 0 };
  private chaseVelScale: SmoothVelocity = { v: 0 };
  /** Previous field centroid for sticky-pan drift compensation. */
  private lastContentAnchor: { x: number; y: number } | null = null;
  /** Compensated camera XY; large centroid jumps ease toward this. */
  private driftFollowPos: { x: number; y: number } | null = null;
  /** Last visible focus we successfully chased (keeps aim stable between reveals). */
  private lockedFocusId: string | null = null;
  /**
   * Optimistic focus from transcript/UI until the worker snapshot confirms it.
   * Wins over stale snapshot.focusNodeId during that gap.
   */
  private uiFocusId: string | null = null;
  /** Pointer currently scrubbing the minimap (not the main canvas pan). */
  private minimapPointerId: number | null = null;
  /** Primary pointer down origin — used to distinguish press vs pan. */
  private pressOrigin: { x: number; y: number; pointerId: number } | null =
    null;
  private pressMoved = false;
  /** Last hovered sphere — activation fires on enter, not every move. */
  private hoveredNodeId: string | null = null;
  /** Client position of the last intentional hover probe. */
  private lastHoverClient = { x: Number.NaN, y: Number.NaN };
  /**
   * When false (entry preview), ignore pan/zoom/hit-testing and hide the
   * minimap so the field is display-only behind the overlay.
   */
  private interactionEnabled = true;
  /** Cursor offset from screen center in [-1, 1], window-space. */
  private overviewMouse = { x: 0, y: 0 };
  /** Fired when the pointer enters a letter-sphere (not while panning). */
  onNodeActivate: ((nodeId: string) => void) | null = null;
  /** Fired when canvas hover enters/leaves a letter-sphere. */
  onNodeHoverChange: ((nodeId: string | null) => void) | null = null;
  /** Fired on a press (no drag) — hit node id, or null for empty canvas. */
  onNodeSelect: ((nodeId: string | null) => void) | null = null;
  /** Fired when the user pans/zooms (shared follow pause). */
  onUserCameraInteract: (() => void) | null = null;
  /** Shared follow-activity clock with the transcript scrubber. */
  getFollowActivityAt: (() => number) | null = null;

  constructor() {
    this.app = new Application();
  }

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      background: "#000000",
      antialias: true,
      resizeTo: host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    // Atlas glyphs after Space Mono is ready so spheres/strands use it.
    await ensureLetterBitmapFont();

    // StrictMode remounts can destroy before async init finishes.
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }

    host.appendChild(this.app.canvas);
    this.world.addChild(this.debug.container);
    // Letter strands sit behind spheres so nodes stay readable.
    this.world.addChild(this.edgeStrings.container);
    this.world.addChild(this.words.container);
    this.app.stage.addChild(this.world);
    // Screen-space overlay — not affected by the world camera transform.
    this.app.stage.addChild(this.minimap.container);

    this.app.canvas.style.touchAction = "none";
    this.app.canvas.style.cursor = "none";
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.addEventListener("pointermove", this.onPointerMove);
    this.app.canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.app.canvas.addEventListener("wheel", this.onWheel, { passive: false });

    this.app.ticker.add(this.onTick);
    this.mounted = true;
    this.applyCamera();
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.mounted) {
      return;
    }
    this.app.ticker.remove(this.onTick);
    this.app.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.app.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.app.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("pointermove", this.onOverviewPointerMove);
    this.app.destroy(true);
    this.mounted = false;
  }

  setSnapshot(snapshot: GraphSnapshot): void {
    const prevFocusId = this.snapshot?.focusNodeId ?? null;
    const prevReady = this.readyNodeCount();
    this.snapshot = snapshot;

    const focusAdvanced =
      !!snapshot.focusNodeId && snapshot.focusNodeId !== prevFocusId;

    if (this.uiFocusId && snapshot.focusNodeId === this.uiFocusId) {
      // Optimistic click/transcript focus confirmed by the worker.
      this.uiFocusId = null;
    } else if (this.uiFocusId && focusAdvanced) {
      // Graph focus moved (ingest/embed/select). Drop the UI pin so
      // home-camera chase can follow. Custom pan is gated by userOverride.
      this.uiFocusId = null;
    }

    const nextReady = this.readyNodeCount();
    if (nextReady === 0) {
      this.invalidateContentAnchor();
    } else if (prevReady === 0 && nextReady > 0) {
      this.syncContentAnchor();
    }
  }

  setSettings(settings: AlgorithmSettings): void {
    this.settings = settings;
  }

  /** Toggle canvas input + minimap (off for the non-interactive entry preview). */
  setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
    this.minimap.container.visible = enabled;
    this.edgeStrings.setRapidSpawn(!enabled);
    if (enabled) {
      this.overviewMouse.x = 0;
      this.overviewMouse.y = 0;
      window.removeEventListener("pointermove", this.onOverviewPointerMove);
      this.syncContentAnchor();
      return;
    }
    this.pointers.clear();
    this.minimapPointerId = null;
    this.pressOrigin = null;
    this.pressMoved = false;
    this.hoveredNodeId = null;
    this.lastHoverClient.x = Number.NaN;
    this.lastHoverClient.y = Number.NaN;
    this.lockedFocusId = null;
    this.uiFocusId = null;
    this.overviewMouse.x = 0;
    this.overviewMouse.y = 0;
    window.addEventListener("pointermove", this.onOverviewPointerMove);
    if (this.mounted) {
      this.app.canvas.style.cursor = "none";
    }
  }

  resetCameraView(): void {
    this.userOverride = false;
    this.forceFollow = false;
    this.chaseVelX.v = 0;
    this.chaseVelY.v = 0;
    this.chaseVelScale.v = 0;
    this.lastUserInputAt = 0;
    const framed = this.contentFrameCamera();
    if (framed) {
      this.camera = framed;
    } else {
      const live = this.liveFocusPoint();
      if (live) {
        this.lockedFocusId = live.id;
        this.camera = this.constrainCamera({
          x: live.x,
          y: live.y,
          scale: CAMERA_FOLLOW.defaultScale,
        });
      } else {
        this.lockedFocusId = null;
        this.camera = this.constrainCamera(resetCamera());
      }
    }
    this.syncContentAnchor();
    this.applyCamera();
  }

  /**
   * Snap the overview camera to the current field. Live layout drift is then
   * tracked each frame in updateOverviewCamera.
   * @returns false if Pixi isn't ready or the field has no visible bounds yet.
   */
  frameContentView(paddingPx = OVERVIEW_CAMERA.paddingPx): boolean {
    if (!this.mounted || !this.snapshot) {
      return false;
    }
    const bounds = this.computeOverviewBounds();
    if (!bounds) {
      this.resetCameraView();
      return false;
    }
    this.userOverride = false;
    this.forceFollow = false;
    this.chaseVelX.v = 0;
    this.chaseVelY.v = 0;
    this.chaseVelScale.v = 0;
    this.lastUserInputAt = 0;
    this.lockedFocusId = null;
    this.uiFocusId = null;
    this.camera = cameraToFitBounds(
      bounds,
      this.app.renderer.width,
      this.app.renderer.height,
      {
        paddingPx,
        scaleFactor: OVERVIEW_CAMERA.fitScale,
        maxScale: OVERVIEW_CAMERA.maxScale,
      },
    );
    this.syncContentAnchor();
    this.applyCamera();
    return true;
  }

  /**
   * Live AABB from rendered sphere positions so framing tracks layout drift
   * as communities settle / shift during the preview.
   */
  private computeOverviewBounds(): WorldBounds | null {
    if (!this.snapshot) {
      return null;
    }
    const display = this.words.getDisplayPositions();
    const points: Array<{ x: number; y: number; radius: number }> = [];
    for (const node of this.snapshot.nodes) {
      if (!node.embeddingReady) {
        continue;
      }
      const pos = display.get(node.id);
      points.push({
        x: pos?.x ?? node.x,
        y: pos?.y ?? node.y,
        radius:
          sphereRadiusForWord(node.label.length, node.fontSize) +
          OVERVIEW_CAMERA.spherePad,
      });
    }
    return contentBoundsForOverview(points);
  }

  /**
   * Single world AABB shared by minimap, pan clamp, and min zoom.
   * Field spheres + a little overscroll — nothing else.
   */
  private navigableBounds(): WorldBounds | null {
    const content = this.computeOverviewBounds();
    if (!content) {
      return null;
    }
    return expandWorldBounds(content, CAMERA_PAN_LIMIT.maxOverscroll);
  }

  private onOverviewPointerMove = (event: PointerEvent): void => {
    if (this.interactionEnabled) {
      return;
    }
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.overviewMouse.x = Math.max(
      -1,
      Math.min(1, (event.clientX / width - 0.5) * 2),
    );
    this.overviewMouse.y = Math.max(
      -1,
      Math.min(1, (event.clientY / height - 0.5) * 2),
    );
  };

  /**
   * Refit every frame to the live field (communities shift under layout),
   * then peek toward the cursor within leftover slack.
   */
  private updateOverviewCamera(dt: number): void {
    if (!this.mounted) {
      return;
    }
    // Always recompute — preview layout keeps moving after hydrate.
    const bounds = this.computeOverviewBounds();
    if (!bounds) {
      return;
    }
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    const fitted = cameraToFitBounds(bounds, width, height, {
      paddingPx: OVERVIEW_CAMERA.paddingPx,
      scaleFactor: OVERVIEW_CAMERA.fitScale,
      maxScale: OVERVIEW_CAMERA.maxScale,
    });
    const halfW = width / (2 * fitted.scale);
    const halfH = height / (2 * fitted.scale);
    const contentW = bounds.maxX - bounds.minX;
    const contentH = bounds.maxY - bounds.minY;
    const slackX =
      Math.max(0, halfW - contentW / 2) * OVERVIEW_CAMERA.slackFactor;
    const slackY =
      Math.max(0, halfH - contentH / 2) * OVERVIEW_CAMERA.slackFactor;
    const targetX = fitted.x + this.overviewMouse.x * slackX;
    const targetY = fitted.y + this.overviewMouse.y * slackY;

    this.camera = {
      x: smoothDamp(
        this.camera.x,
        targetX,
        this.chaseVelX,
        OVERVIEW_CAMERA.smoothTime,
        OVERVIEW_CAMERA.maxSpeed,
        dt,
      ),
      y: smoothDamp(
        this.camera.y,
        targetY,
        this.chaseVelY,
        OVERVIEW_CAMERA.smoothTime,
        OVERVIEW_CAMERA.maxSpeed,
        dt,
      ),
      scale: smoothDamp(
        this.camera.scale,
        fitted.scale,
        this.chaseVelScale,
        OVERVIEW_CAMERA.zoomSmoothTime,
        2,
        dt,
      ),
    };
  }

  /** Resume home-camera chase on a node (click / transcript select). */
  focusNode(nodeId: string): void {
    const wasOverride = this.userOverride;
    this.userOverride = false;
    this.lastUserInputAt = 0;
    this.forceFollow = true;
    // Only kill momentum when leaving a free-pan. Resetting mid-chase makes
    // retargets hitch; SmoothDamp can redirect an existing velocity cleanly.
    if (wasOverride) {
      this.chaseVelX.v = 0;
      this.chaseVelY.v = 0;
      this.chaseVelScale.v = 0;
    }
    this.uiFocusId = nodeId;
    this.lockedFocusId = nodeId;
  }

  /** Stop camera chase + minimap focus halo (Escape / empty-canvas deselect). */
  clearFocus(): void {
    this.uiFocusId = null;
    this.lockedFocusId = null;
    this.forceFollow = false;
    this.chaseVelX.v = 0;
    this.chaseVelY.v = 0;
    this.chaseVelScale.v = 0;
    // Drop stale snapshot focus immediately — otherwise the next tick
    // re-locks from focusNodeId before the worker clear arrives.
    if (this.snapshot) {
      this.snapshot = { ...this.snapshot, focusNodeId: null };
    }
  }

  private contentFrameCamera(): CameraState | null {
    const bounds = this.computeOverviewBounds();
    if (!bounds || !this.mounted) {
      return null;
    }
    return cameraToFitBounds(
      bounds,
      this.app.renderer.width,
      this.app.renderer.height,
      {
        paddingPx: OVERVIEW_CAMERA.paddingPx,
        scaleFactor: OVERVIEW_CAMERA.fitScale,
        maxScale: OVERVIEW_CAMERA.maxScale,
      },
    );
  }

  private readyNodeCount(): number {
    if (!this.snapshot) {
      return 0;
    }
    let count = 0;
    for (const node of this.snapshot.nodes) {
      if (node.embeddingReady) {
        count += 1;
      }
    }
    return count;
  }

  private contentAnchor(): { x: number; y: number } | null {
    if (!this.snapshot) {
      return null;
    }
    const display = this.words.getDisplayPositions();
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const node of this.snapshot.nodes) {
      if (!node.embeddingReady) {
        continue;
      }
      const pos = display.get(node.id);
      sumX += pos?.x ?? node.x;
      sumY += pos?.y ?? node.y;
      count += 1;
    }
    if (count === 0) {
      return null;
    }
    return { x: sumX / count, y: sumY / count };
  }

  private invalidateContentAnchor(): void {
    this.lastContentAnchor = null;
    this.driftFollowPos = null;
  }

  private syncContentAnchor(): void {
    this.lastContentAnchor = this.contentAnchor();
    this.driftFollowPos = { x: this.camera.x, y: this.camera.y };
  }

  /** Sticky-pan: translate with the field centroid (ease large jumps). */
  private applyLayoutDriftCompensation(dt: number): void {
    const anchor = this.contentAnchor();
    if (!anchor || this.readyNodeCount() === 0) {
      this.invalidateContentAnchor();
      return;
    }

    if (!this.lastContentAnchor) {
      this.lastContentAnchor = anchor;
      this.driftFollowPos = { x: this.camera.x, y: this.camera.y };
      return;
    }

    const dx = anchor.x - this.lastContentAnchor.x;
    const dy = anchor.y - this.lastContentAnchor.y;
    this.lastContentAnchor = anchor;

    if (!this.driftFollowPos) {
      this.driftFollowPos = { x: this.camera.x, y: this.camera.y };
    }
    this.driftFollowPos.x += dx;
    this.driftFollowPos.y += dy;

    const step = Math.hypot(dx, dy);
    const catchUp = Math.hypot(
      this.driftFollowPos.x - this.camera.x,
      this.driftFollowPos.y - this.camera.y,
    );

    if (
      step <= CAMERA_FOLLOW.maxDriftStep &&
      catchUp <= CAMERA_FOLLOW.maxDriftStep
    ) {
      this.camera = {
        ...this.camera,
        x: this.driftFollowPos.x,
        y: this.driftFollowPos.y,
      };
      this.chaseVelX.v = 0;
      this.chaseVelY.v = 0;
      return;
    }

    this.camera = {
      ...this.camera,
      x: smoothDamp(
        this.camera.x,
        this.driftFollowPos.x,
        this.chaseVelX,
        CAMERA_FOLLOW.smoothTime,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
      y: smoothDamp(
        this.camera.y,
        this.driftFollowPos.y,
        this.chaseVelY,
        CAMERA_FOLLOW.smoothTime,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
    };
  }

  private easeCameraTo(target: CameraState, dt: number): void {
    this.camera = {
      x: smoothDamp(
        this.camera.x,
        target.x,
        this.chaseVelX,
        CAMERA_FOLLOW.smoothTime,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
      y: smoothDamp(
        this.camera.y,
        target.y,
        this.chaseVelY,
        CAMERA_FOLLOW.smoothTime,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
      scale: smoothDamp(
        this.camera.scale,
        target.scale,
        this.chaseVelScale,
        CAMERA_FOLLOW.zoomSmoothTime,
        2,
        dt,
      ),
    };
  }

  /** Min zoom = exactly fit the navigable bounds (same region as the minimap). */
  private scaleRange(): { min: number; max: number } {
    const bounds = this.navigableBounds();
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    if (!bounds) {
      return { min: CAMERA_ZOOM.minScale, max: CAMERA_ZOOM.maxScale };
    }
    const fit = minScaleToFitBounds(bounds, width, height);
    return {
      min: Math.max(CAMERA_ZOOM.minScale, fit),
      max: CAMERA_ZOOM.maxScale,
    };
  }

  private constrainCamera(camera: CameraState): CameraState {
    const bounds = this.navigableBounds();
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    const { min, max } = this.scaleRange();
    const scaled = {
      ...camera,
      scale: Math.min(max, Math.max(min, camera.scale)),
    };
    // slack=0 — bounds are already the navigable AABB the minimap uses.
    return clampCameraToContent(scaled, bounds, { width, height }, 0);
  }

  /** Clamp after user input and start the idle countdown. */
  private commitCamera(camera: CameraState): void {
    this.userOverride = true;
    this.forceFollow = false;
    this.chaseVelX.v = 0;
    this.chaseVelY.v = 0;
    this.chaseVelScale.v = 0;
    this.lastUserInputAt = performance.now();
    // Never hard-snap from the live view — home chase can sit outside the
    // pan AABB, and the first drag must continue from where the user is.
    this.camera = this.constrainCameraFrom(this.camera, camera);
    this.syncContentAnchor();
    this.applyCamera();
    this.onUserCameraInteract?.();
  }

  /**
   * Like constrainCamera, but preserves continuity when `previous` is already
   * outside the navigable focus range.
   */
  private constrainCameraFrom(
    previous: CameraState,
    proposed: CameraState,
  ): CameraState {
    const bounds = this.navigableBounds();
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    const { min, max } = this.scaleRange();
    const clampScale = (camera: CameraState): CameraState => ({
      ...camera,
      scale: Math.min(max, Math.max(min, camera.scale)),
    });
    return clampCameraPan(
      clampScale(previous),
      clampScale(proposed),
      bounds,
      { width, height },
      0,
    );
  }

  /**
   * Focus target for the home camera. Only chases nodes that are already
   * visible (embeddingReady) so we never whip toward pre-placement coords.
   *
   * `uiFocusId` is optimistic click/transcript select only — setSnapshot
   * clears it when graph focus confirms or advances (ingest/embed/select).
   */
  private liveFocusPoint(): { id: string; x: number; y: number } | null {
    const nodes = this.snapshot?.nodes ?? [];
    const requested = this.uiFocusId ?? this.snapshot?.focusNodeId;
    if (!requested) {
      return null;
    }
    const candidateIds = [requested, this.lockedFocusId].filter(
      (id): id is string => !!id,
    );

    for (const focusId of candidateIds) {
      const focus = nodes.find((node) => node.id === focusId);
      if (!focus?.embeddingReady) {
        continue;
      }
      const displayed = this.words.getDisplayPositions().get(focusId);
      this.lockedFocusId = focusId;
      return {
        id: focusId,
        x: displayed?.x ?? focus.x,
        y: displayed?.y ?? focus.y,
      };
    }

    return null;
  }

  /** Ms since the latest of local camera input and shared transcript activity. */
  private followIdleMs(): number {
    const shared = this.getFollowActivityAt?.() ?? 0;
    const latest = Math.max(this.lastUserInputAt, shared);
    if (latest <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    return performance.now() - latest;
  }

  /** Same pause gate as home-camera (for transcript live-edge). */
  isHomeFollowPaused(): boolean {
    if (this.forceFollow) {
      return false;
    }
    return this.followIdleMs() < CAMERA_FOLLOW.idleReturnMs;
  }

  private updateHomeCamera(dt: number): void {
    if (!this.interactionEnabled) {
      this.updateOverviewCamera(dt);
      return;
    }

    // Keep override alive while a gesture is still in progress.
    // Input paths call commitCamera; don't re-clamp here (that teleported).
    if (this.pointers.size > 0 || this.minimapPointerId !== null) {
      this.lastUserInputAt = performance.now();
      this.syncContentAnchor();
      if (this.userOverride) {
        this.onUserCameraInteract?.();
      }
      return;
    }

    if (this.forceFollow || this.uiFocusId) {
      const followPaused =
        !this.forceFollow && this.followIdleMs() < CAMERA_FOLLOW.idleReturnMs;
      if (followPaused) {
        this.syncContentAnchor();
        return;
      }
      const live = this.liveFocusPoint();
      if (live) {
        this.syncContentAnchor();
        this.easeCameraTo(
          {
            x: live.x,
            y: live.y,
            scale: CAMERA_FOLLOW.defaultScale,
          },
          dt,
        );
        return;
      }
    }

    if (this.userOverride) {
      this.applyLayoutDriftCompensation(dt);
      this.softPullCameraInsideBounds(dt);
      return;
    }

    const framed = this.contentFrameCamera();
    if (framed) {
      this.easeCameraTo(framed, dt);
    }
    this.syncContentAnchor();
  }

  /** Ease back inside pan limits; don't raise zoom when fit-min increases. */
  private softPullCameraInsideBounds(dt: number): void {
    const bounds = this.navigableBounds();
    const width = this.app.renderer.width;
    const height = this.app.renderer.height;
    const { max } = this.scaleRange();
    let targetX = this.camera.x;
    let targetY = this.camera.y;
    const targetScale = Math.min(max, this.camera.scale);

    if (bounds) {
      const halfW = width / (2 * Math.max(1e-6, this.camera.scale));
      const halfH = height / (2 * Math.max(1e-6, this.camera.scale));
      const limited = clampCameraToContent(
        this.camera,
        bounds,
        { width, height },
        0,
      );
      if (bounds.maxX - bounds.minX > halfW * 2) {
        targetX = limited.x;
      }
      if (bounds.maxY - bounds.minY > halfH * 2) {
        targetY = limited.y;
      }
    }

    if (
      targetX === this.camera.x &&
      targetY === this.camera.y &&
      targetScale === this.camera.scale
    ) {
      return;
    }

    this.camera = {
      x: smoothDamp(
        this.camera.x,
        targetX,
        this.chaseVelX,
        0.22,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
      y: smoothDamp(
        this.camera.y,
        targetY,
        this.chaseVelY,
        0.22,
        CAMERA_FOLLOW.maxSpeed,
        dt,
      ),
      scale: smoothDamp(
        this.camera.scale,
        targetScale,
        this.chaseVelScale,
        0.22,
        2,
        dt,
      ),
    };
  }

  private applyCamera(): void {
    const transform = applyCameraTransform(
      this.camera,
      this.app.renderer.width,
      this.app.renderer.height,
    );
    this.world.position.set(transform.x, transform.y);
    this.world.scale.set(transform.scale);
  }

  private onTick = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.snapshot) {
      return;
    }

    const viewport = worldViewportBounds(
      this.camera,
      this.app.renderer.width,
      this.app.renderer.height,
    );
    this.words.update(
      this.snapshot.nodes,
      dt,
      viewport,
      this.camera.scale,
    );
    const displayPositions = this.words.getDisplayPositions();
    this.edgeStrings.update(
      this.snapshot.edges,
      this.snapshot.nodes,
      displayPositions,
      dt,
      viewport,
      this.camera.scale,
    );
    this.debug.update(this.snapshot, this.settings, displayPositions);
    this.updateHomeCamera(dt);
    this.applyCamera();
    if (this.interactionEnabled) {
      this.minimap.update(
        this.snapshot.nodes,
        this.camera,
        this.app.renderer.width,
        this.app.renderer.height,
        displayPositions,
        this.lockedFocusId ?? this.snapshot.focusNodeId,
        this.navigableBounds(),
      );
    } else {
      this.minimap.container.visible = false;
    }
  };

  private canvasPoint(event: {
    clientX: number;
    clientY: number;
  }): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return {
      x: ((event.clientX - rect.left) / width) * this.app.renderer.width,
      y: ((event.clientY - rect.top) / height) * this.app.renderer.height,
    };
  }

  /** True when the topmost element under the pointer is the field canvas. */
  private isPointerOverCanvas(clientX: number, clientY: number): boolean {
    const top = document.elementFromPoint(clientX, clientY);
    if (!(top instanceof Element)) {
      return false;
    }
    return top === this.app.canvas || !!top.closest(".canvas-host");
  }

  private focusFromMinimap(event: {
    clientX: number;
    clientY: number;
  }): void {
    const point = this.canvasPoint(event);
    const world = this.minimap.screenToWorld(point.x, point.y);
    if (!world) {
      return;
    }
    this.commitCamera({
      ...this.camera,
      x: world.x,
      y: world.y,
    });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactionEnabled) {
      return;
    }
    const point = this.canvasPoint(event);
    if (this.minimap.containsScreenPoint(point.x, point.y)) {
      this.minimapPointerId = event.pointerId;
      this.pressOrigin = null;
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      this.focusFromMinimap(event);
      return;
    }

    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    if (this.pointers.size === 1) {
      this.lastPanPoint = { x: event.clientX, y: event.clientY };
      this.pressOrigin = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
      this.pressMoved = false;
    } else if (this.pointers.size === 2) {
      this.pressOrigin = null;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interactionEnabled) {
      return;
    }
    if (this.minimapPointerId === event.pointerId) {
      this.focusFromMinimap(event);
      return;
    }

    if (!this.pointers.has(event.pointerId)) {
      this.updateHoverCursor(event);
      return;
    }

    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    });

    if (
      this.pressOrigin &&
      this.pressOrigin.pointerId === event.pointerId &&
      !this.pressMoved
    ) {
      const moved = Math.hypot(
        event.clientX - this.pressOrigin.x,
        event.clientY - this.pressOrigin.y,
      );
      if (moved > CLICK_SLOP_PX) {
        this.pressMoved = true;
      }
    }

    if (this.pointers.size >= 2) {
      this.handleTouchPinch();
      return;
    }

    // Stay put until the gesture exceeds slop — keeps light presses from nudging.
    if (!this.pressMoved) {
      return;
    }

    const dx = event.clientX - this.lastPanPoint.x;
    const dy = event.clientY - this.lastPanPoint.y;
    this.lastPanPoint = { x: event.clientX, y: event.clientY };
    this.commitCamera(panCamera(this.camera, dx, dy));
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.interactionEnabled) {
      return;
    }
    if (this.minimapPointerId === event.pointerId) {
      this.minimapPointerId = null;
      return;
    }

    this.pointers.delete(event.pointerId);

    if (this.pressOrigin?.pointerId === event.pointerId) {
      const wasClick = !this.pressMoved;
      this.pressOrigin = null;
      this.pressMoved = false;

      if (
        wasClick &&
        // Pointer capture can deliver the up over UI chrome; don't select
        // a node sitting under the transcript / detail panel.
        this.isPointerOverCanvas(event.clientX, event.clientY)
      ) {
        const point = this.canvasPoint(event);
        const world = screenToWorld(
          this.camera,
          point.x,
          point.y,
          this.app.renderer.width,
          this.app.renderer.height,
        );
        const hit = this.words.hitTest(world.x, world.y);
        this.onNodeSelect?.(hit);
      }
    }

    if (this.pointers.size === 1) {
      const remaining = this.pointers.values().next().value;
      if (remaining) {
        this.lastPanPoint = { x: remaining.x, y: remaining.y };
      }
      this.pinchDistance = 0;
    } else if (this.pointers.size === 0) {
      this.pinchDistance = 0;
    } else {
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private onPointerLeave = (): void => {
    this.lastHoverClient.x = Number.NaN;
    this.lastHoverClient.y = Number.NaN;
    if (this.hoveredNodeId !== null) {
      this.hoveredNodeId = null;
      this.onNodeHoverChange?.(null);
    }
  };

  private updateHoverCursor(event: PointerEvent): void {
    const dx = event.clientX - this.lastHoverClient.x;
    const dy = event.clientY - this.lastHoverClient.y;
    const clientTravel = Number.isFinite(this.lastHoverClient.x)
      ? Math.hypot(dx, dy)
      : Infinity;
    const eventTravel = Math.hypot(event.movementX, event.movementY);
    if (clientTravel < HOVER_INTENT_PX && eventTravel < HOVER_INTENT_PX) {
      return;
    }
    this.lastHoverClient.x = event.clientX;
    this.lastHoverClient.y = event.clientY;

    const point = this.canvasPoint(event);
    if (this.minimap.containsScreenPoint(point.x, point.y)) {
      if (this.hoveredNodeId !== null) {
        this.hoveredNodeId = null;
        this.onNodeHoverChange?.(null);
      }
      return;
    }
    const world = screenToWorld(
      this.camera,
      point.x,
      point.y,
      this.app.renderer.width,
      this.app.renderer.height,
    );
    const hit = this.words.hitTest(world.x, world.y);
    if (hit !== this.hoveredNodeId) {
      this.hoveredNodeId = hit;
      this.onNodeHoverChange?.(hit);
      if (hit) {
        this.onNodeActivate?.(hit);
      }
    }
  }

  private onWheel = (event: WheelEvent): void => {
    // Always claim the gesture so the browser never page-zooms over the canvas.
    event.preventDefault();
    if (!this.interactionEnabled) {
      return;
    }

    const point = this.canvasPoint(event);
    if (this.minimap.containsScreenPoint(point.x, point.y)) {
      // Ignore wheel over the map so it doesn't accidentally zoom the field.
      return;
    }

    // Trackpad pinch is delivered as ctrl+wheel in Chromium/WebKit.
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      const range = this.scaleRange();
      this.commitCamera(
        zoomAt(
          this.camera,
          factor,
          point.x,
          point.y,
          this.app.renderer.width,
          this.app.renderer.height,
          range,
        ),
      );
      return;
    }

    let dx = event.deltaX;
    let dy = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dx *= 16;
      dy *= 16;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      dx *= this.app.renderer.width;
      dy *= this.app.renderer.height;
    }

    // Two-finger scroll pans; invert for natural trackpad direction.
    this.commitCamera(panCamera(this.camera, -dx, -dy));
  };

  private handleTouchPinch(): void {
    const nextDistance = this.currentPinchDistance();
    if (this.pinchDistance <= 1e-3 || nextDistance <= 1e-3) {
      this.pinchDistance = nextDistance;
      return;
    }

    const factor = nextDistance / this.pinchDistance;
    this.pinchDistance = nextDistance;

    const midpoint = this.currentPinchMidpoint();
    const rect = this.app.canvas.getBoundingClientRect();
    const range = this.scaleRange();
    this.commitCamera(
      zoomAt(
        this.camera,
        factor,
        midpoint.x - rect.left,
        midpoint.y - rect.top,
        this.app.renderer.width,
        this.app.renderer.height,
        range,
      ),
    );
  }

  private currentPinchDistance(): number {
    const points = [...this.pointers.values()];
    if (points.length < 2) {
      return 0;
    }
    const a = points[0]!;
    const b = points[1]!;
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  private currentPinchMidpoint(): { x: number; y: number } {
    const points = [...this.pointers.values()];
    const a = points[0]!;
    const b = points[1]!;
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }
}
