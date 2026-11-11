import type { Size } from "../geometry/coords";

/**
 * Page layout and render windowing (D12). Pure functions over page sizes in PDF points — no DOM
 * measurement — so a 100-page document is testable headlessly.
 */

/** Vertical gap between pages and outer margin, in page points (scales with zoom → exact anchor math). */
export const PAGE_GAP_PT = 12;
/** Pages rendered on each side of the visible range. */
export const OVERSCAN_PAGES = 2;
/** No PDF.js canvas may exceed this many device pixels on its longest side. */
export const MAX_CANVAS_SIDE_PX = 4096;
/** Design limit (D12). Larger documents still open; the limit is what the tests and QA cover. */
export const DESIGN_PAGE_LIMIT = 100;

export interface PageSlot {
  /** 1-based page number. */
  page: number;
  /** Content-pixel box of the page inside the page stack at the given scale. */
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DocumentLayout {
  scale: number;
  slots: PageSlot[];
  contentWidth: number;
  contentHeight: number;
}

/** Stacks pages vertically and centres each horizontally. `pageSizes[i]` is page i+1 in displayed points. */
export function computeLayout(pageSizes: readonly Size[], scale: number): DocumentLayout {
  const gap = PAGE_GAP_PT * scale;
  const maxWidth = pageSizes.reduce((m, s) => Math.max(m, s.width), 0) * scale;
  const contentWidth = maxWidth + 2 * gap;
  const slots: PageSlot[] = [];
  let y = gap;
  pageSizes.forEach((size, i) => {
    const width = size.width * scale;
    const height = size.height * scale;
    slots.push({ page: i + 1, top: y, left: (contentWidth - width) / 2, width, height });
    y += height + gap;
  });
  return { scale, slots, contentWidth, contentHeight: y };
}

export interface Viewport {
  scrollTop: number;
  height: number;
}

/** Visible area (px²-free: vertical overlap × width) of each page intersecting the viewport. */
export function visiblePages(layout: DocumentLayout, viewport: Viewport): Array<{ page: number; visibleArea: number }> {
  const top = viewport.scrollTop;
  const bottom = top + viewport.height;
  const out: Array<{ page: number; visibleArea: number }> = [];
  for (const slot of firstSlotsFrom(layout, top)) {
    if (slot.top >= bottom) break;
    const overlap = Math.min(bottom, slot.top + slot.height) - Math.max(top, slot.top);
    if (overlap > 0) out.push({ page: slot.page, visibleArea: overlap * slot.width });
  }
  return out;
}

/** Binary search for the first slot whose bottom edge is below `y`, then iterate from there. */
function* firstSlotsFrom(layout: DocumentLayout, y: number): Generator<PageSlot> {
  const { slots } = layout;
  let lo = 0;
  let hi = slots.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const s = slots[mid];
    if (s && s.top + s.height <= y) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < slots.length; i++) {
    const s = slots[i];
    if (s) yield s;
  }
}

/** Inclusive 1-based page range to render: visible pages plus OVERSCAN_PAGES on each side. */
export function renderWindow(
  layout: DocumentLayout,
  viewport: Viewport,
  overscan = OVERSCAN_PAGES,
): { first: number; last: number } | null {
  const vis = visiblePages(layout, viewport);
  const firstVisible = vis[0];
  const lastVisible = vis[vis.length - 1];
  if (!firstVisible || !lastVisible) {
    if (layout.slots.length === 0) return null;
    // Viewport is in a gap or past the end: render around the nearest page.
    const nearest = nearestPage(layout, viewport.scrollTop + viewport.height / 2);
    return clampRange(nearest - overscan, nearest + overscan, layout.slots.length);
  }
  return clampRange(firstVisible.page - overscan, lastVisible.page + overscan, layout.slots.length);
}

function clampRange(first: number, last: number, count: number): { first: number; last: number } {
  return { first: Math.max(1, first), last: Math.min(count, last) };
}

export function nearestPage(layout: DocumentLayout, y: number): number {
  let best = 1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of layout.slots) {
    const d = y < s.top ? s.top - y : y > s.top + s.height ? y - s.top - s.height : 0;
    if (d < bestDist) {
      bestDist = d;
      best = s.page;
    }
  }
  return best;
}

/** D5: in markup mode the live page is the one with the largest visible area (ties → lower page). */
export function pageWithLargestVisibleArea(layout: DocumentLayout, viewport: Viewport): number | null {
  let best: { page: number; visibleArea: number } | null = null;
  for (const v of visiblePages(layout, viewport)) {
    if (!best || v.visibleArea > best.visibleArea) best = v;
  }
  return best ? best.page : null;
}

/**
 * Device-pixel size of a page's PDF.js canvas, capped at MAX_CANVAS_SIDE_PX on its longest side (D12).
 * Returns the render scale to pass to page.getViewport({ scale }).
 */
export function canvasRenderSize(
  pageSizePt: Size,
  zoom: number,
  devicePixelRatio: number,
  cap = MAX_CANVAS_SIDE_PX,
): { width: number; height: number; renderScale: number } {
  const desired = zoom * Math.max(1, devicePixelRatio);
  const longest = Math.max(pageSizePt.width, pageSizePt.height);
  const renderScale = longest * desired > cap ? cap / longest : desired;
  return {
    width: Math.min(cap, Math.floor(pageSizePt.width * renderScale)),
    height: Math.min(cap, Math.floor(pageSizePt.height * renderScale)),
    renderScale,
  };
}

/** Scroll offset that puts the top of `page` at the top of the viewport. */
export function scrollTopForPage(layout: DocumentLayout, page: number): number {
  const slot = layout.slots[page - 1];
  if (!slot) return 0;
  return Math.max(0, slot.top - PAGE_GAP_PT * layout.scale);
}
