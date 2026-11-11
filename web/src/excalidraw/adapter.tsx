/**
 * The ONLY module that imports @excalidraw/excalidraw. Everything Excalidraw-specific — the live editor,
 * static SVG previews and the export rasterizer — sits here so the rest of the core stays testable and
 * Excalidraw can be mocked in one place.
 */
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  exportToCanvas,
  exportToSvg,
  getCommonBounds,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef } from "react";
import { DEFAULT_TEXT_SIZE } from "../../build/vendorPatches";
import {
  EQUATION_KIND,
  equationFile,
  equationFileId,
  equationFiles,
  isEquationElement,
  normalizeLatex,
  type EquationData,
  type EquationRenderer,
} from "../equations/equation";
import { excalidrawViewState, type Rect, type Size } from "../geometry/coords";
import { EXPORT_RASTER_SCALE, type RasterizePage } from "../export/flatten";
import type { SidecarElement } from "../sidecar/schema";
import type { LiveEditorHandle, SelectedEquation } from "../controller/documentController";

type SceneElements = Parameters<typeof exportToSvg>[0]["elements"];
type SceneElement = SceneElements[number];

const asScene = (elements: readonly SidecarElement[]): SceneElements => elements as unknown as SceneElements;
const asFiles = (files: Record<string, unknown>): BinaryFiles => files as unknown as BinaryFiles;

/** excalidrawViewState() typed for Excalidraw's branded zoom value. */
const pinnedView = (zoom: number): Pick<AppState, "zoom" | "scrollX" | "scrollY"> =>
  excalidrawViewState(zoom) as unknown as Pick<AppState, "zoom" | "scrollX" | "scrollY">;

/** Padding (page points) added around the elements' bounds in previews/rasters so stroke widths are not clipped. */
export const OVERLAY_PADDING_PT = 8;

/** D7: every Excalidraw feature that could add files or reach the network is switched off here. */
const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: true,
    export: false as const,
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: false,
    toggleTheme: false,
  },
  tools: { image: false },
  welcomeScreen: false,
};

export interface LiveMarkupLayerProps {
  page: number;
  /** Elements to seed the editor with; read once at mount (the instance is remounted on reload). */
  initialElements: readonly SidecarElement[];
  zoom: number;
  penMode: boolean;
  readOnly: boolean;
  equations: EquationRenderer;
  onElementsChange: (page: number, elements: readonly unknown[]) => void;
  onLiveEditor?: (handle: LiveEditorHandle | null) => void;
  onSelectedEquationChange?: (selection: SelectedEquation | null) => void;
  /** Double-click / Enter on the selected equation: open the LaTeX editor instead of Excalidraw's image crop. */
  onEditEquationRequest?: () => void;
}

/**
 * The single live Excalidraw editor. DocumentView guarantees at most one of these is mounted (D5).
 * Scene coordinates are page points: the view state is pinned to { zoom, scrollX: 0, scrollY: 0 } and
 * re-pinned whenever Excalidraw tries to pan or zoom on its own (D3).
 */
export function LiveMarkupLayer(props: LiveMarkupLayerProps) {
  const { page, initialElements, zoom, penMode, readOnly, equations, onElementsChange, onLiveEditor, onSelectedEquationChange, onEditEquationRequest } = props;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  const selectedRef = useRef<string>("");
  zoomRef.current = zoom;

  useEffect(() => {
    apiRef.current?.updateScene({ appState: pinnedView(zoom) });
  }, [zoom]);

  useEffect(() => {
    if (!onLiveEditor) return;
    const visibleCenter = (): { x: number; y: number } => {
      const r = containerRef.current?.getBoundingClientRect();
      const z = zoomRef.current;
      if (!r || r.width === 0) return { x: 72, y: 72 };
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight || r.bottom);
      const left = Math.max(r.left, 0);
      const right = Math.min(r.right, window.innerWidth || r.right);
      return { x: ((left + right) / 2 - r.left) / z, y: ((top + bottom) / 2 - r.top) / z };
    };
    const handle: LiveEditorHandle = {
      insertEquation(raw) {
        const api = apiRef.current;
        if (!api) return;
        const data: EquationData = { kind: EQUATION_KIND, latex: normalizeLatex(raw), color: api.getAppState().currentItemStrokeColor };
        const file = equationFile(equations, data);
        const size = equations.render(data.latex, data.color);
        const c = visibleCenter();
        const [base] = convertToExcalidrawElements([
          { type: "image", fileId: file.id as never, x: c.x - size.width / 2, y: c.y - size.height / 2, width: size.width, height: size.height },
        ]);
        if (!base) return;
        const element = { ...base, status: "saved", customData: data } as unknown as SceneElement;
        api.addFiles([file as never]);
        api.updateScene({
          elements: [...api.getSceneElementsIncludingDeleted(), element],
          appState: { selectedElementIds: { [element.id]: true } } as never,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      },
      updateEquation(id, raw) {
        const api = apiRef.current;
        if (!api) return;
        const all = api.getSceneElementsIncludingDeleted();
        const target = all.find((e) => e.id === id);
        if (!target || !isEquationElement(target)) return;
        const data: EquationData = { ...target.customData, latex: normalizeLatex(raw) };
        const file = equationFile(equations, data);
        const size = equations.render(data.latex, data.color);
        api.addFiles([file as never]);
        const next = newElementWith(target as never, {
          fileId: equationFileId(data.latex, data.color),
          width: size.width,
          height: size.height,
          customData: data,
        } as never);
        api.updateScene({
          elements: all.map((e) => (e.id === id ? (next as unknown as typeof e) : e)),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      },
    };
    onLiveEditor(handle);
    return () => {
      onLiveEditor(null);
      onSelectedEquationChange?.(null);
    };
  }, [equations, onLiveEditor, onSelectedEquationChange]);

  return (
    <div
      className="markup-live"
      data-live-page={page}
      ref={containerRef}
      onDoubleClickCapture={(e) => {
        if (selectedRef.current && onEditEquationRequest) {
          e.preventDefault();
          e.stopPropagation();
          onEditEquationRequest();
        }
      }}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && selectedRef.current && onEditEquationRequest) {
          e.preventDefault();
          e.stopPropagation();
          onEditEquationRequest();
        }
      }}
    >
      <Excalidraw
        initialData={{
          elements: asScene(initialElements),
          files: asFiles(equationFiles(equations, initialElements)),
          appState: {
            ...pinnedView(zoom),
            viewBackgroundColor: "transparent",
            penMode,
            penDetected: penMode,
            currentItemFontSize: DEFAULT_TEXT_SIZE,
          },
          scrollToContent: false,
        }}
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        onChange={(elements, appState) => {
          onElementsChange(page, elements);
          const pinned = pinnedView(zoomRef.current);
          if (
            appState.zoom.value !== pinned.zoom.value ||
            appState.scrollX !== 0 ||
            appState.scrollY !== 0
          ) {
            // Excalidraw never owns pan/zoom (D3): snap back to the controller's view.
            queueMicrotask(() => apiRef.current?.updateScene({ appState: pinned }));
          }
          if (onSelectedEquationChange) {
            const ids = Object.keys(appState.selectedElementIds).filter((k) => appState.selectedElementIds[k]);
            const el = ids.length === 1 ? elements.find((e) => e.id === ids[0] && !e.isDeleted) : undefined;
            const sel = el && isEquationElement(el) ? { id: el.id, latex: el.customData.latex } : null;
            const key = sel ? `${sel.id}\u0000${sel.latex}` : "";
            if (key !== selectedRef.current) {
              selectedRef.current = key;
              onSelectedEquationChange(sel);
            }
          }
        }}
        viewModeEnabled={readOnly}
        UIOptions={UI_OPTIONS}
        validateEmbeddable={() => false}
        renderEmbeddable={() => null}
        aiEnabled={false}
        handleKeyboardGlobally={false}
        autoFocus
      />
    </div>
  );
}

/** Bounds of the elements in page points, padded, or null when there is nothing visible. */
export function overlayBounds(elements: readonly SidecarElement[]): Rect | null {
  if (elements.length === 0) return null;
  const [minX, minY, maxX, maxY] = getCommonBounds(asScene(elements));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    x: minX - OVERLAY_PADDING_PT,
    y: minY - OVERLAY_PADDING_PT,
    width: maxX - minX + 2 * OVERLAY_PADDING_PT,
    height: maxY - minY + 2 * OVERLAY_PADDING_PT,
  };
}

/** Static read-only preview for a non-live page (D5): SVG markup plus where to place it, in page points. */
export interface StaticPreview {
  svg: string;
  rect: Rect;
}

/** Static previews include equations, re-rendered from their LaTeX. */
export function makeStaticPreviewRenderer(equations: EquationRenderer) {
  return async (elements: readonly SidecarElement[]): Promise<StaticPreview | null> => {
    const rect = overlayBounds(elements);
    if (!rect) return null;
    const svg = await exportToSvg({
      elements: asScene(elements),
      appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false },
      files: asFiles(equationFiles(equations, elements)),
      exportPadding: OVERLAY_PADDING_PT,
      // Previews live in this page, where Excalidraw's fonts are already loaded. Inlining would run
      // Excalidraw's font-subsetting worker, which needs eval (blocked by the CSP) and is slow.
      skipInliningFonts: true,
    });
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("preserveAspectRatio", "none");
    return { svg: svg.outerHTML, rect };
  };
}

/** Production rasterizer for flattened export (D9): exportToCanvas at 3x, transparent PNG. */
export function makeExcalidrawRasterizer(equations: EquationRenderer): RasterizePage {
  return async (_page, elements, _size: Size) => {
    const rect = overlayBounds(elements);
    if (!rect) return null;
    const canvas: HTMLCanvasElement = await exportToCanvas({
      elements: asScene(elements),
      appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false },
      files: asFiles(equationFiles(equations, elements)),
      exportPadding: OVERLAY_PADDING_PT,
      getDimensions: (w: number, h: number) => ({ width: w * EXPORT_RASTER_SCALE, height: h * EXPORT_RASTER_SCALE, scale: EXPORT_RASTER_SCALE }),
    });
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b: Blob | null) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
    );
    return { png: new Uint8Array(await blob.arrayBuffer()), rect };
  };
}
