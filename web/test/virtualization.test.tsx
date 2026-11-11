import { act, cleanup, render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Excalidraw is replaced by a probe that counts live mounts. Only this module is mocked; the real
// adapter, DocumentView, layout and windowing code run unchanged.
const probe = vi.hoisted(() => ({ live: 0, maxLive: 0, mounts: 0, pages: [] as number[] }));
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: () => {
    useEffect(() => {
      probe.live += 1;
      probe.mounts += 1;
      probe.maxLive = Math.max(probe.maxLive, probe.live);
      return () => {
        probe.live -= 1;
      };
    }, []);
    return createElement("div", { "data-excalidraw": "live" });
  },
  exportToSvg: vi.fn(async () => document.createElementNS("http://www.w3.org/2000/svg", "svg")),
  exportToCanvas: vi.fn(),
  getCommonBounds: () => [0, 0, 10, 10],
}));

import { DocumentView, selectLivePage, type DocumentViewProps } from "../src/components/DocumentView";
import { PreviewCache } from "../src/components/previewCache";
import {
  MAX_CANVAS_SIDE_PX,
  OVERSCAN_PAGES,
  canvasRenderSize,
  computeLayout,
  pageWithLargestVisibleArea,
  renderWindow,
  scrollTopForPage,
  visiblePages,
} from "../src/virtualization/layout";
import { element, fakePdfSource, hundredPageSizes } from "./fixtures/fakes";

const VIEWPORT_H = 900;

function setup(overrides: Partial<DocumentViewProps> = {}) {
  const source = fakePdfSource(hundredPageSizes());
  const layout = computeLayout(source.pageSizes, 1);
  const cache = new PreviewCache(async () => ({ svg: "<svg></svg>", rect: { x: 0, y: 0, width: 10, height: 10 } }));
  const props: DocumentViewProps = {
    source,
    layout,
    range: renderWindow(layout, { scrollTop: 0, height: VIEWPORT_H }),
    mode: "reading",
    activePage: null,
    readOnly: false,
    penMode: true,
    sceneEpoch: 0,
    devicePixelRatio: 2,
    previewCache: cache,
    elementsFor: (p) => (p % 3 === 0 ? [element(`e${p}`)] : []),
    revisionFor: () => 0,
    onElementsChange: () => undefined,
    onActivatePage: () => undefined,
    ...overrides,
  };
  const view = render(<DocumentView {...props} />);
  const rerender = (next: Partial<DocumentViewProps>) => {
    Object.assign(props, next);
    view.rerender(<DocumentView {...props} />);
  };
  return { view, props, layout, source, rerender };
}

const pagesInDom = (c: HTMLElement) => [...c.querySelectorAll("[data-page]")].map((n) => Number(n.getAttribute("data-page")));
const liveInDom = (c: HTMLElement) => c.querySelectorAll("[data-excalidraw='live']").length;

beforeEach(() => {
  probe.live = 0;
  probe.maxLive = 0;
  probe.mounts = 0;
});
afterEach(cleanup);

describe("render window on a 100-page document (D12)", () => {
  it("renders only the visible pages plus 2 on each side", () => {
    const { view, layout } = setup();
    const visible = visiblePages(layout, { scrollTop: 0, height: VIEWPORT_H }).map((v) => v.page);
    const pages = pagesInDom(view.container);
    expect(pages[0]).toBe(1);
    expect(pages).toEqual(Array.from({ length: (visible.at(-1) ?? 0) + OVERSCAN_PAGES }, (_, i) => i + 1));
    expect(pages.length).toBeLessThan(10);
  });

  it("slides the window as the document scrolls and never renders the whole document", () => {
    const { view, layout, rerender } = setup();
    for (const target of [10, 37, 50, 73, 99, 100]) {
      const scrollTop = scrollTopForPage(layout, target);
      const range = renderWindow(layout, { scrollTop, height: VIEWPORT_H });
      rerender({ range });
      const pages = pagesInDom(view.container);
      const visible = visiblePages(layout, { scrollTop, height: VIEWPORT_H }).map((v) => v.page);
      const first = visible[0] ?? 1;
      const last = visible.at(-1) ?? 1;
      expect(pages[0]).toBe(Math.max(1, first - OVERSCAN_PAGES));
      expect(pages.at(-1)).toBe(Math.min(100, last + OVERSCAN_PAGES));
      expect(pages).toContain(target);
      expect(pages.length).toBeLessThanOrEqual(last - first + 1 + 2 * OVERSCAN_PAGES);
      expect(view.container.querySelectorAll("canvas[data-pdf-canvas]").length).toBe(pages.length);
    }
  });

  it("releases PDF.js canvases that leave the window", async () => {
    const { layout, rerender, source } = setup();
    await act(async () => undefined);
    rerender({ range: renderWindow(layout, { scrollTop: scrollTopForPage(layout, 60), height: VIEWPORT_H }) });
    expect(source.cancelled).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("caps every canvas at 4096 px on its longest side", () => {
    for (const zoom of [1, 4, 8]) {
      for (const dpr of [1, 2, 3]) {
        const s = canvasRenderSize({ width: 960, height: 540 }, zoom, dpr);
        expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_CANVAS_SIDE_PX);
      }
    }
    expect(canvasRenderSize({ width: 600, height: 800 }, 1, 2).renderScale).toBe(2);
  });
});

describe("live Excalidraw mounting (D5)", () => {
  it("mounts zero instances in reading mode", () => {
    const { view } = setup({ mode: "reading", activePage: 2 });
    expect(liveInDom(view.container)).toBe(0);
    expect(probe.maxLive).toBe(0);
  });

  it("mounts exactly one instance on the active page in markup mode", () => {
    const { view } = setup({ mode: "markup", activePage: 2 });
    expect(liveInDom(view.container)).toBe(1);
    expect(view.container.querySelector("[data-page='2'] [data-excalidraw='live']")).not.toBeNull();
    expect(probe.live).toBe(1);
  });

  it("never has more than one instance mounted while the active page and window move across 100 pages", () => {
    const { view, layout, rerender } = setup({ mode: "markup", activePage: 1 });
    for (let page = 1; page <= 100; page += 3) {
      const scrollTop = scrollTopForPage(layout, page);
      const viewport = { scrollTop, height: VIEWPORT_H };
      rerender({ range: renderWindow(layout, viewport), activePage: pageWithLargestVisibleArea(layout, viewport) });
      expect(liveInDom(view.container)).toBeLessThanOrEqual(1);
      expect(probe.live).toBeLessThanOrEqual(1);
    }
    rerender({ mode: "reading" });
    expect(probe.live).toBe(0);
    expect(probe.maxLive).toBe(1);
    expect(probe.mounts).toBeGreaterThan(1);
  });

  it("shows static previews (not live editors) on non-active pages that have markup", async () => {
    const { view } = setup({ mode: "markup", activePage: 1 });
    await act(async () => undefined);
    expect(view.container.querySelectorAll("[data-static-page]").length).toBeGreaterThan(0);
    expect(view.container.querySelector("[data-page='3'] [data-static-page='3']")).not.toBeNull();
    expect(liveInDom(view.container)).toBe(1);
  });

  it("selectLivePage is the single guard: reading → none, markup → the active page only", () => {
    expect(selectLivePage("reading", 5)).toBeNull();
    expect(selectLivePage("markup", 5)).toBe(5);
    expect(selectLivePage("markup", null)).toBeNull();
  });

  it("pencil/mouse down on a non-live page asks to move the live instance there", () => {
    const onActivatePage = vi.fn();
    const { view } = setup({ mode: "markup", activePage: 1, onActivatePage });
    const page3 = view.container.querySelector("[data-page='3']");
    if (!page3) throw new Error("page 3 not rendered");
    const ev = new MouseEvent("pointerdown", { bubbles: true }) as MouseEvent & { pointerType?: string };
    Object.defineProperty(ev, "pointerType", { value: "pen" });
    act(() => {
      page3.dispatchEvent(ev);
    });
    expect(onActivatePage).toHaveBeenCalledWith(3);
  });
});

describe("static preview cache", () => {
  it("regenerates a page preview only when that page's revision changes", async () => {
    const cache = new PreviewCache(async () => ({ svg: "<svg/>", rect: { x: 0, y: 0, width: 1, height: 1 } }));
    const els = [element("a")];
    await cache.get(4, 0, els);
    await cache.get(4, 0, els);
    await cache.get(5, 0, els);
    expect(cache.renders).toBe(2);
    await cache.get(4, 1, els);
    expect(cache.renders).toBe(3);
  });
});
