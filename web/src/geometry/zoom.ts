import type { Point } from "./coords";

/**
 * ZoomController — the single owner of zoom (D3).
 *
 * Native pinch-zoom is disabled in both shells; WebKit gesture events / ctrl+wheel are routed here.
 * During a gesture the controller yields ONE CSS transform for the whole page stack (PDF canvas and markup
 * scale together). On commit it returns the new scale and the scroll offsets that keep the content under
 * the gesture anchor fixed. The layout is fully proportional to scale (gaps are in page points too), so
 * the anchor math is exact. Excalidraw never zooms or pans itself; it is told the committed scale.
 */

export interface ScrollPosition {
  left: number;
  top: number;
}

export interface ZoomCommit {
  scale: number;
  scroll: ScrollPosition;
}

export interface GestureTransform {
  /** Applied to the page stack element during a live pinch. */
  transform: string;
  /** Transform origin in page-stack content pixels. */
  transformOrigin: string;
  /** Effective (clamped) scale the user currently sees. */
  previewScale: number;
}

export interface ZoomLimits {
  min: number;
  max: number;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.25, max: 8 };

interface ActiveGesture {
  anchor: Point; // in viewport px relative to the scroller's top-left
  scroll: ScrollPosition;
  factor: number;
}

export class ZoomController {
  private committed: number;
  private gesture: ActiveGesture | null = null;

  constructor(
    initialScale = 1,
    private readonly limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
  ) {
    this.committed = this.clamp(initialScale);
  }

  get scale(): number {
    return this.committed;
  }

  get isGestureActive(): boolean {
    return this.gesture !== null;
  }

  clamp(scale: number): number {
    if (!Number.isFinite(scale) || scale <= 0) return this.limits.min;
    return Math.min(this.limits.max, Math.max(this.limits.min, scale));
  }

  beginGesture(anchor: Point, scroll: ScrollPosition): void {
    this.gesture = { anchor, scroll, factor: 1 };
  }

  /** `factor` is the cumulative pinch scale since beginGesture (WebKit GestureEvent.scale semantics). */
  updateGesture(factor: number): GestureTransform {
    const g = this.requireGesture();
    const previewScale = this.clamp(this.committed * factor);
    g.factor = previewScale / this.committed;
    const ox = g.scroll.left + g.anchor.x;
    const oy = g.scroll.top + g.anchor.y;
    return {
      transform: `scale(${round6(g.factor)})`,
      transformOrigin: `${round6(ox)}px ${round6(oy)}px`,
      previewScale,
    };
  }

  endGesture(): ZoomCommit {
    const g = this.requireGesture();
    this.gesture = null;
    return this.zoomTo(this.committed * g.factor, g.anchor, g.scroll);
  }

  cancelGesture(): void {
    this.gesture = null;
  }

  /** Zooms to `target`, keeping the content under `anchor` (viewport px) fixed. */
  zoomTo(target: number, anchor: Point, scroll: ScrollPosition): ZoomCommit {
    const next = this.clamp(target);
    const k = next / this.committed;
    this.committed = next;
    return {
      scale: next,
      scroll: {
        left: Math.max(0, (scroll.left + anchor.x) * k - anchor.x),
        top: Math.max(0, (scroll.top + anchor.y) * k - anchor.y),
      },
    };
  }

  /** Scale at which the widest page fills the viewport width minus margins on both sides. */
  fitWidthScale(viewportWidth: number, maxPageWidthPt: number, marginPx = 16): number {
    if (maxPageWidthPt <= 0) return this.committed;
    return this.clamp((viewportWidth - 2 * marginPx) / maxPageWidthPt);
  }

  private requireGesture(): ActiveGesture {
    if (!this.gesture) throw new Error("no zoom gesture in progress");
    return this.gesture;
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
