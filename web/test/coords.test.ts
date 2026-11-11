import { describe, expect, it } from "vitest";
import {
  displayedSize,
  displayedToUserSpace,
  excalidrawSceneToViewport,
  excalidrawViewportToScene,
  excalidrawViewState,
  normalizeRotation,
  overlayPlacement,
  pageToViewport,
  viewportToPage,
  type PageRotation,
} from "../src/geometry/coords";
import { ZoomController } from "../src/geometry/zoom";
import { computeLayout } from "../src/virtualization/layout";

const TOL = 1e-4;

// Page sizes in points: 4:3 slide, 16:9 slide, US Letter portrait, A4 landscape, a tall strip.
const PAGE_SIZES = [
  { width: 720, height: 540 },
  { width: 960, height: 540 },
  { width: 612, height: 792 },
  { width: 842, height: 595 },
  { width: 300, height: 2000 },
];
const ZOOMS = [0.25, 0.5, 1, 1.37, 2, 3.5, 8];

function samplePoints(w: number, h: number) {
  const pts = [];
  for (const fx of [0, 0.1, 0.333, 0.5, 0.9, 1]) for (const fy of [0, 0.25, 0.71, 1]) pts.push({ x: fx * w, y: fy * h });
  return pts;
}

describe("viewport ↔ normalized page coordinates", () => {
  it("round-trips viewport → page points (scale 1.0) → viewport within 1e-4 for every aspect ratio and zoom", () => {
    for (const size of PAGE_SIZES) {
      for (const zoom of ZOOMS) {
        const origin = { x: 37.25 + zoom, y: -1234.5 * zoom };
        for (const p of samplePoints(size.width, size.height)) {
          const client = pageToViewport(p, origin, zoom);
          const back = viewportToPage(client, origin, zoom);
          expect(Math.abs(back.x - p.x)).toBeLessThan(TOL);
          expect(Math.abs(back.y - p.y)).toBeLessThan(TOL);
          const again = pageToViewport(back, origin, zoom);
          expect(Math.abs(again.x - client.x)).toBeLessThan(TOL);
          expect(Math.abs(again.y - client.y)).toBeLessThan(TOL);
        }
      }
    }
  });

  it("stores the same page coordinate for the same page spot at any zoom (zoom never mutates the scene)", () => {
    for (const size of PAGE_SIZES) {
      const layouts = ZOOMS.map((z) => computeLayout([size], z));
      const spot = { x: size.width * 0.42, y: size.height * 0.77 };
      for (const layout of layouts) {
        const slot = layout.slots[0];
        if (!slot) throw new Error("no slot");
        const origin = { x: slot.left - 50, y: slot.top - 200 }; // scrolled
        const client = { x: origin.x + spot.x * layout.scale, y: origin.y + spot.y * layout.scale };
        const stored = viewportToPage(client, origin, layout.scale);
        expect(Math.abs(stored.x - spot.x)).toBeLessThan(TOL);
        expect(Math.abs(stored.y - spot.y)).toBeLessThan(TOL);
      }
    }
  });

  it("the pinned Excalidraw view state reproduces the page mapping exactly (scene coords == page points)", () => {
    for (const zoom of ZOOMS) {
      const view = excalidrawViewState(zoom);
      const offset = { x: 113, y: 57.5 };
      for (const p of samplePoints(612, 792)) {
        const viaExcalidraw = excalidrawSceneToViewport(p, view, offset);
        const viaPage = pageToViewport(p, offset, zoom);
        expect(Math.abs(viaExcalidraw.x - viaPage.x)).toBeLessThan(TOL);
        expect(Math.abs(viaExcalidraw.y - viaPage.y)).toBeLessThan(TOL);
        const scene = excalidrawViewportToScene(viaExcalidraw, view, offset);
        expect(Math.abs(scene.x - p.x)).toBeLessThan(TOL);
        expect(Math.abs(scene.y - p.y)).toBeLessThan(TOL);
      }
    }
  });

  it("rejects non-positive zoom", () => {
    expect(() => viewportToPage({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toThrow(RangeError);
    expect(() => pageToViewport({ x: 0, y: 0 }, { x: 0, y: 0 }, Number.NaN)).toThrow(RangeError);
  });
});

describe("ZoomController (D3)", () => {
  it("keeps the content under the pinch anchor fixed across zoom levels", () => {
    const pageSizes = [PAGE_SIZES[0], PAGE_SIZES[2], PAGE_SIZES[3]].filter((s) => s !== undefined);
    for (const start of [0.5, 1, 2]) {
      for (const factor of [0.5, 1.3, 2.7]) {
        const zc = new ZoomController(start);
        const before = computeLayout(pageSizes, zc.scale);
        const scroll = { left: 40, top: 900 };
        const anchor = { x: 210, y: 333 };
        const page = before.slots[1];
        if (!page) throw new Error("no slot");
        const spot = viewportToPage({ x: scroll.left + anchor.x, y: scroll.top + anchor.y }, { x: page.left, y: page.top }, before.scale);

        zc.beginGesture(anchor, scroll);
        const t = zc.updateGesture(factor);
        expect(t.transform).toMatch(/^scale\(/);
        const commit = zc.endGesture();

        const after = computeLayout(pageSizes, commit.scale);
        const pageAfter = after.slots[1];
        if (!pageAfter) throw new Error("no slot");
        const spotAfter = viewportToPage(
          { x: commit.scroll.left + anchor.x, y: commit.scroll.top + anchor.y },
          { x: pageAfter.left, y: pageAfter.top },
          after.scale,
        );
        // Horizontal centring shifts with content width, so only the vertical anchor is exact here.
        expect(Math.abs(spotAfter.y - spot.y)).toBeLessThan(TOL);
      }
    }
  });

  it("clamps to limits and yields one CSS transform for the whole stack during a pinch", () => {
    const zc = new ZoomController(1, { min: 0.5, max: 4 });
    zc.beginGesture({ x: 0, y: 0 }, { left: 0, top: 0 });
    expect(zc.updateGesture(100).previewScale).toBe(4);
    expect(zc.endGesture().scale).toBe(4);
    expect(zc.zoomTo(0.01, { x: 0, y: 0 }, { left: 0, top: 0 }).scale).toBe(0.5);
    expect(zc.fitWidthScale(1032, 1000, 16)).toBe(1);
  });
});

describe("rotation-aware overlay placement for export", () => {
  const box = { x: 10, y: 20, width: 600, height: 800 };

  it("maps the displayed top-left corner to the right user-space corner for each /Rotate", () => {
    const expected: Record<PageRotation, { x: number; y: number }> = {
      0: { x: 10, y: 820 },
      90: { x: 10, y: 20 },
      180: { x: 610, y: 20 },
      270: { x: 610, y: 820 },
    };
    for (const r of [0, 90, 180, 270] as PageRotation[]) {
      expect(displayedToUserSpace({ x: 0, y: 0 }, box, r)).toEqual(expected[r]);
    }
  });

  it("a full-page overlay covers exactly the page box for every rotation", () => {
    for (const r of [0, 90, 180, 270] as PageRotation[]) {
      const d = displayedSize(box, r);
      const p = overlayPlacement({ x: 0, y: 0, ...d }, box, r);
      // Corners of the drawn image after rotating by +r around (p.x, p.y).
      const rad = (r * Math.PI) / 180;
      const corner = (u: number, v: number) => ({
        x: p.x + u * Math.cos(rad) - v * Math.sin(rad),
        y: p.y + u * Math.sin(rad) + v * Math.cos(rad),
      });
      const cs = [corner(0, 0), corner(p.width, 0), corner(0, p.height), corner(p.width, p.height)];
      const xs = cs.map((c) => c.x);
      const ys = cs.map((c) => c.y);
      expect(Math.min(...xs)).toBeCloseTo(box.x, 6);
      expect(Math.max(...xs)).toBeCloseTo(box.x + box.width, 6);
      expect(Math.min(...ys)).toBeCloseTo(box.y, 6);
      expect(Math.max(...ys)).toBeCloseTo(box.y + box.height, 6);
    }
  });

  it("normalizes arbitrary rotation values", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });
});
