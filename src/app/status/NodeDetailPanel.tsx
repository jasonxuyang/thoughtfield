import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import type { GraphSnapshot, RenderNode } from "../../graph/graph-types";
import { placeAnchoredTooltip } from "../controls/tooltip-placement";

type ScrollThumb = {
  top: number;
  height: number;
};

/** Inset so the thumb doesn’t kiss the panel’s top/bottom edges. */
const SCROLL_THUMB_INSET_PX = 6;

export type NodeNeighbor = {
  id: string;
  label: string;
  weight: number;
  semanticScore: number;
  colocationScore: number;
};

export type NodeDetail = {
  id: string;
  label: string;
  occurrenceCount: number;
  degree: number;
  communitySize: number;
  semanticRatio: number;
  activation: number;
  neighbors: NodeNeighbor[];
};

const TOOLTIPS = {
  heard: "How often this word has surfaced in the conversation so far.",
  links: "How many other words this one reaches across the field.",
  cluster: "How large the neighborhood is that this word settled into.",
  affinity:
    "What pulls this word toward others — shared meaning, or shared place in the transcript.",
  semantic: "Drawn together by meaning — ideas that belong with each other.",
  proximity:
    "Drawn together by place in the transcript — words that sit near each other as you speak.",
  connected: "Every word this one reaches. Tap one to step into it.",
} as const;

type TipState = {
  text: string;
  /** Anchor center X / top / bottom of the hovered target. */
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
};

type TipApi = {
  show: (text: string, target: HTMLElement) => void;
  hide: () => void;
};

const TipContext = createContext<TipApi | null>(null);

function affinityPercent(weight: number): number {
  return Math.max(0, Math.min(100, Math.round(weight * 100)));
}

function Tip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<{
    className?: string;
    "data-cursor"?: "help";
    onPointerEnter?: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave?: (event: React.PointerEvent<HTMLElement>) => void;
  }>;
}) {
  const api = useContext(TipContext);
  const child = Children.only(children);
  if (!api || !isValidElement(child)) {
    return children;
  }

  const className = child.props.className?.includes("node-detail-tip-label")
    ? child.props.className
    : [child.props.className, "node-detail-tip-label"].filter(Boolean).join(" ");

  return cloneElement(child, {
    className,
    "data-cursor": "help" as const,
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      child.props.onPointerEnter?.(event);
      api.show(text, event.currentTarget);
    },
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
      child.props.onPointerLeave?.(event);
      api.hide();
    },
  });
}

function AffinityBar({ semanticRatio }: { semanticRatio: number }) {
  const semantic = Math.max(
    0,
    Math.min(100, Math.round(semanticRatio * 100)),
  );
  const proximity = 100 - semantic;

  return (
    <div className="node-detail-affinity">
      <div
        className="node-detail-affinity-track"
        role="img"
        aria-label={`${semantic}% semantic, ${proximity}% proximity`}
      >
        <span
          className="node-detail-affinity-semantic"
          style={{ width: `${semantic}%` }}
        />
        <span
          className="node-detail-affinity-colocation"
          style={{ width: `${proximity}%` }}
        />
      </div>
      <div className="node-detail-affinity-legend">
        <span>
          <i className="node-detail-affinity-swatch is-semantic" aria-hidden />
          {semantic}%{" "}
          <Tip text={TOOLTIPS.semantic}>
            <span className="node-detail-tip-label">semantic</span>
          </Tip>
        </span>
        <span>
          <i className="node-detail-affinity-swatch is-colocation" aria-hidden />
          {proximity}%{" "}
          <Tip text={TOOLTIPS.proximity}>
            <span className="node-detail-tip-label">proximity</span>
          </Tip>
        </span>
      </div>
    </div>
  );
}

export function nodeDetailsEqual(
  a: NodeDetail | null,
  b: NodeDetail | null,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  if (
    a.id !== b.id ||
    a.occurrenceCount !== b.occurrenceCount ||
    a.degree !== b.degree ||
    a.communitySize !== b.communitySize ||
    a.neighbors.length !== b.neighbors.length ||
    Math.abs(a.semanticRatio - b.semanticRatio) >= 0.01
  ) {
    return false;
  }
  for (let i = 0; i < a.neighbors.length; i += 1) {
    const left = a.neighbors[i]!;
    const right = b.neighbors[i]!;
    if (
      left.id !== right.id ||
      Math.abs(left.weight - right.weight) >= 0.01
    ) {
      return false;
    }
  }
  return true;
}

export function buildNodeDetail(
  snapshot: GraphSnapshot,
  nodeId: string,
): NodeDetail | null {
  const node = snapshot.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }

  const byId = new Map<string, RenderNode>();
  for (const entry of snapshot.nodes) {
    byId.set(entry.id, entry);
  }

  const neighbors: NodeNeighbor[] = [];
  for (const edge of snapshot.graphEdges) {
    let otherId: string | null = null;
    if (edge.sourceId === nodeId) {
      otherId = edge.targetId;
    } else if (edge.targetId === nodeId) {
      otherId = edge.sourceId;
    }
    if (!otherId) {
      continue;
    }
    const other = byId.get(otherId);
    if (!other) {
      continue;
    }
    neighbors.push({
      id: other.id,
      label: other.label,
      weight: edge.combinedWeight,
      semanticScore: edge.semanticScore,
      colocationScore: edge.colocationScore,
    });
  }

  neighbors.sort((a, b) => b.weight - a.weight);

  return {
    id: node.id,
    label: node.label,
    occurrenceCount: node.occurrenceCount,
    degree: node.degree,
    communitySize: node.communitySize,
    semanticRatio: node.semanticRatio,
    activation: node.activation,
    neighbors,
  };
}

export function NodeDetailPanel({
  detail,
  onClose,
  onSelectNeighbor,
}: {
  detail: NodeDetail;
  onClose: () => void;
  onSelectNeighbor: (nodeId: string) => void;
}) {
  const [tip, setTip] = useState<TipState | null>(null);
  const [panelHovered, setPanelHovered] = useState(false);
  const [scrollThumb, setScrollThumb] = useState<ScrollThumb | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback((text: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setTip({
      text,
      anchorX: rect.left + rect.width / 2,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
    });
  }, []);

  const hide = useCallback(() => {
    setTip(null);
  }, []);

  const syncScrollThumb = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setScrollThumb(null);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setScrollThumb(null);
      return;
    }
    const track = Math.max(0, clientHeight - SCROLL_THUMB_INSET_PX * 2);
    const height = Math.max(28, (clientHeight / scrollHeight) * track);
    const maxTop = track - height;
    const top =
      SCROLL_THUMB_INSET_PX +
      (maxTop <= 0
        ? 0
        : (scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setScrollThumb({ top, height });
  }, []);

  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!tip || !el) {
      return;
    }

    placeAnchoredTooltip(el, tip, "below");
    el.dataset.ready = "true";
  }, [tip]);

  // Jump back to the top when stepping into a different word.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = 0;
    hide();
    syncScrollThumb();
  }, [detail.id, hide, syncScrollThumb]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    syncScrollThumb();
    const ro = new ResizeObserver(() => {
      syncScrollThumb();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [detail.neighbors.length, syncScrollThumb]);

  const tipApi = useMemo(() => ({ show, hide }), [show, hide]);

  const thumbStyle = useMemo((): CSSProperties | undefined => {
    if (!scrollThumb) {
      return undefined;
    }
    return {
      transform: `translateY(${scrollThumb.top}px)`,
      height: scrollThumb.height,
    };
  }, [scrollThumb]);

  return (
    <TipContext.Provider value={tipApi}>
      <aside
        className={[
          "node-detail-panel",
          panelHovered ? "is-hovered" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={`Details for ${detail.label}`}
        onPointerEnter={() => {
          setPanelHovered(true);
        }}
        onPointerLeave={() => {
          setPanelHovered(false);
          hide();
        }}
      >
        <div
          ref={scrollRef}
          className="node-detail-panel-scroll"
          onScroll={syncScrollThumb}
        >
          <header className="node-detail-header">
            <h2 className="node-detail-title">{detail.label}</h2>
            <button
              type="button"
              className="node-detail-close"
              onClick={onClose}
              aria-label="Close details"
            >
              ×
            </button>
          </header>

          <dl className="node-detail-stats">
            <div className="node-detail-stat">
              <Tip text={TOOLTIPS.heard}>
                <dt className="node-detail-tip-label">Heard</dt>
              </Tip>
              <dd>{detail.occurrenceCount}×</dd>
            </div>
            <div className="node-detail-stat">
              <Tip text={TOOLTIPS.links}>
                <dt className="node-detail-tip-label">Links</dt>
              </Tip>
              <dd>{detail.degree}</dd>
            </div>
            <div className="node-detail-stat">
              <Tip text={TOOLTIPS.cluster}>
                <dt className="node-detail-tip-label">Cluster</dt>
              </Tip>
              <dd>{detail.communitySize} words</dd>
            </div>
          </dl>

          <div className="node-detail-affinity-block">
            <Tip text={TOOLTIPS.affinity}>
              <span className="node-detail-affinity-label node-detail-tip-label">
                Affinity
              </span>
            </Tip>
            <AffinityBar semanticRatio={detail.semanticRatio} />
          </div>

          {detail.neighbors.length > 0 ? (
            <section className="node-detail-neighbors">
              <Tip text={TOOLTIPS.connected}>
                <h3 className="node-detail-tip-label">Connected</h3>
              </Tip>
              <div className="node-detail-tags">
                {detail.neighbors.map((neighbor) => {
                  const percent = affinityPercent(neighbor.weight);
                  return (
                    <button
                      key={neighbor.id}
                      type="button"
                      className="node-detail-tag"
                      onClick={() => onSelectNeighbor(neighbor.id)}
                    >
                      <span className="node-detail-tag-label">
                        {neighbor.label}
                      </span>
                      <span className="node-detail-tag-percent">
                        {percent}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <p className="node-detail-empty">No connections yet.</p>
          )}
        </div>
        {scrollThumb ? (
          <div
            className="node-detail-scrollbar"
            aria-hidden
            style={thumbStyle}
          />
        ) : null}
      </aside>

      {tip
        ? createPortal(
            <div ref={tipRef} className="node-detail-tooltip" role="tooltip">
              {tip.text}
            </div>,
            document.body,
          )
        : null}
    </TipContext.Provider>
  );
}
