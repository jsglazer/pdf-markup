import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Platform } from "../bridge/protocol";
import type { DocumentController, Mode } from "../controller/documentController";
import { ZoomController, type ScrollPosition } from "../geometry/zoom";
import type { PdfDocumentSource } from "../pdf/pdfSource";
import type { Scheduler } from "../sidecar/sceneStore";
import {
  computeLayout,
  pageWithLargestVisibleArea,
  renderWindow,
  scrollTopForPage,
} from "../virtualization/layout";
import { DocumentView } from "./DocumentView";
import { FingerPan, routePointer, routeWheel, wheelZoomFactor } from "./inputRouting";
import type { PreviewCache } from "./previewCache";
import type { EquationRenderer } from "../equations/equation";

/** After scrolling settles in markup mode, the live instance follows the most visible page (D5). */
export const ACTIVE_PAGE_SETTLE_MS = 150;

interface Props {
  controller: DocumentController;
  source: PdfDocumentSource;
  platform: Platform;
  mode: Mode;
  activePage: number | null;
  readOnly: boolean;
  sceneEpoch: number;
  previewCache: PreviewCache;
  scheduler: Scheduler;
  zoomCommand: { kind: "in" | "out" | "fit"; nonce: number } | null;
  navigateTo: { page: number; nonce: number } | null;
  onCurrentPageChange: (page: number) => void;
  equations: EquationRenderer;
}

interface GestureEventLike extends UIEvent {
  scale: number;
  clientX: number;
  clientY: number;
}

export function DocumentScroller(props: Props) {
  const { controller, source, platform, mode } = props;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<ZoomController | null>(null);
  const pendingScroll = useRef<ScrollPosition | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });
  const [scrollTop, setScrollTop] = useState(0);
  const [scale, setScale] = useState(1);
  const [fitted, setFitted] = useState(false);

  zoomRef.current ??= new ZoomController(1);
  const zoom = zoomRef.current;

  const maxPageWidth = useMemo(() => source.pageSizes.reduce((m, s) => Math.max(m, s.width), 0), [source]);
  const layout = useMemo(() => computeLayout(source.pageSizes, scale), [source, scale]);
  const range = renderWindow(layout, { scrollTop, height: viewport.height });

  // Viewport size.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth || 1024, height: el.clientHeight || 768 });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Initial fit-to-width.
  useEffect(() => {
    if (fitted || maxPageWidth <= 0) return;
    const target = zoom.fitWidthScale(viewport.width, maxPageWidth);
    zoom.zoomTo(target, { x: 0, y: 0 }, { left: 0, top: 0 });
    setScale(zoom.scale);
    setFitted(true);
  }, [fitted, maxPageWidth, viewport.width, zoom]);

  // Apply scroll correction after a committed zoom re-lays out the stack.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const target = pendingScroll.current;
    if (!el || !target) return;
    pendingScroll.current = null;
    el.scrollLeft = target.left;
    el.scrollTop = target.top;
    setScrollTop(target.top);
  }, [scale]);

  const commitZoom = (target: number, anchor: { x: number; y: number }) => {
    const el = scrollerRef.current;
    const scroll = { left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 };
    const commit = zoom.zoomTo(target, anchor, scroll);
    pendingScroll.current = commit.scroll;
    setScale(commit.scale);
  };

  // Toolbar zoom commands.
  useEffect(() => {
    if (!props.zoomCommand) return;
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    if (props.zoomCommand.kind === "fit") commitZoom(zoom.fitWidthScale(viewport.width, maxPageWidth), { x: 0, y: 0 });
    else commitZoom(zoom.scale * (props.zoomCommand.kind === "in" ? 1.25 : 0.8), center);
  }, [props.zoomCommand?.nonce]);

  // Page navigation.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!props.navigateTo || !el) return;
    el.scrollTop = scrollTopForPage(layout, props.navigateTo.page);
    setScrollTop(el.scrollTop);
  }, [props.navigateTo?.nonce]);

  // Report the current page; in markup mode move the live instance after scrolling settles (D5).
  const { onCurrentPageChange } = props;
  useEffect(() => {
    const current = pageWithLargestVisibleArea(layout, { scrollTop, height: viewport.height });
    if (current !== null) onCurrentPageChange(current);
    if (mode !== "markup" || current === null) return;
    const handle = props.scheduler.setTimeout(() => controller.activatePage(current), ACTIVE_PAGE_SETTLE_MS);
    return () => props.scheduler.clearTimeout(handle);
  }, [layout, scrollTop, viewport.height, mode, controller, onCurrentPageChange, props.scheduler]);

  // Gesture + wheel routing (D3/D4). Capture phase on window/stack so Excalidraw never sees these events.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const stack = stackRef.current;
    if (!scroller || !stack) return;
    const pageStack = () => stack.querySelector<HTMLElement>(".page-stack");
    const anchorOf = (clientX: number, clientY: number) => {
      const r = scroller.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const onGestureStart = (e: Event) => {
      const g = e as GestureEventLike;
      e.preventDefault();
      e.stopPropagation();
      zoom.beginGesture(anchorOf(g.clientX, g.clientY), { left: scroller.scrollLeft, top: scroller.scrollTop });
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!zoom.isGestureActive) return;
      const t = zoom.updateGesture((e as GestureEventLike).scale);
      const ps = pageStack();
      if (ps) {
        ps.style.transformOrigin = t.transformOrigin;
        ps.style.transform = t.transform; // one transform: PDF canvas + markup scale together
      }
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!zoom.isGestureActive) return;
      const commit = zoom.endGesture();
      const ps = pageStack();
      if (ps) ps.style.transform = "";
      pendingScroll.current = commit.scroll;
      setScale(commit.scale); // re-render PDF.js at the committed scale; Excalidraw gets it via props
    };
    const onWheel = (e: WheelEvent) => {
      if (routeWheel(e.ctrlKey) === "zoom") {
        e.preventDefault();
        e.stopPropagation();
        commitZoom(zoom.scale * wheelZoomFactor(e.deltaY), anchorOf(e.clientX, e.clientY));
        return;
      }
      // Plain wheel: keep it away from Excalidraw; the browser's default scroll moves the document.
      if ((e.target as Element | null)?.closest?.(".markup-live")) e.stopPropagation();
    };

    const pan = new FingerPan();
    const onPointerDown = (e: PointerEvent) => {
      if (routePointer(e.pointerType, platform, mode) !== "documentPan") return;
      e.stopPropagation();
      pan.start(e.pointerId, e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (routePointer(e.pointerType, platform, mode) !== "documentPan") return;
      e.stopPropagation();
      const d = pan.move(e.pointerId, e.clientX, e.clientY);
      if (d) scroller.scrollBy(d.dx, d.dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (routePointer(e.pointerType, platform, mode) !== "documentPan") return;
      e.stopPropagation();
      pan.end(e.pointerId);
    };

    window.addEventListener("gesturestart", onGestureStart, { capture: true, passive: false });
    window.addEventListener("gesturechange", onGestureChange, { capture: true, passive: false });
    window.addEventListener("gestureend", onGestureEnd, { capture: true, passive: false });
    stack.addEventListener("wheel", onWheel, { capture: true, passive: false });
    stack.addEventListener("pointerdown", onPointerDown, { capture: true });
    stack.addEventListener("pointermove", onPointerMove, { capture: true });
    stack.addEventListener("pointerup", onPointerUp, { capture: true });
    stack.addEventListener("pointercancel", onPointerUp, { capture: true });
    return () => {
      window.removeEventListener("gesturestart", onGestureStart, { capture: true });
      window.removeEventListener("gesturechange", onGestureChange, { capture: true });
      window.removeEventListener("gestureend", onGestureEnd, { capture: true });
      stack.removeEventListener("wheel", onWheel, { capture: true });
      stack.removeEventListener("pointerdown", onPointerDown, { capture: true });
      stack.removeEventListener("pointermove", onPointerMove, { capture: true });
      stack.removeEventListener("pointerup", onPointerUp, { capture: true });
      stack.removeEventListener("pointercancel", onPointerUp, { capture: true });
    };
  }, [platform, mode, zoom]);

  return (
    <div
      ref={scrollerRef}
      className={`scroller mode-${mode}`}
      data-testid="scroller"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div ref={stackRef}>
        <DocumentView
          source={source}
          layout={layout}
          range={range}
          mode={mode}
          activePage={props.activePage}
          readOnly={props.readOnly}
          penMode={platform === "ios"}
          sceneEpoch={props.sceneEpoch}
          devicePixelRatio={typeof window === "undefined" ? 1 : window.devicePixelRatio || 1}
          previewCache={props.previewCache}
          elementsFor={(p) => controller.elements(p)}
          revisionFor={(p) => controller.revision(p)}
          onElementsChange={controller.updatePage}
          onActivatePage={(p) => controller.activatePage(p)}
          equations={props.equations}
          onLiveEditor={controller.setLiveEditor}
          onSelectedEquationChange={controller.setSelectedEquation}
          onEditEquationRequest={controller.requestEquationEdit}
        />
      </div>
    </div>
  );
}
