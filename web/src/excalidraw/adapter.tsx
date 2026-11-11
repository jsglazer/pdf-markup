/**
 * The ONLY module that imports @excalidraw/excalidraw. Everything Excalidraw-specific — the live editor,
 * static SVG previews and the export rasterizer — sits here so the rest of the core stays testable and
 * Excalidraw can be mocked in one place.
 */
import { Excalidraw, exportToCanvas, exportToSvg, getCommonBounds } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef } from "react";
import { excalidrawViewState, type Rect, type Size } from "../geometry/coords";
import { EXPORT_RASTER_SCALE, type RasterizePage } from "../export/flatten";
import type { SidecarElement } from "../sidecar/schema";

type SceneElements = Parameters<typeof exportToSvg>[0]["elements"];

const asScene = (elements: readonly SidecarElement[]): SceneElements => elements as unknown as SceneElements;

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
  onElementsChange: (page: number, elements: readonly unknown[]) => void;
}

/**
 * The single live Excalidraw editor. DocumentView guarantees at most one of these is mounted (D5).
 * Scene coordinates are page points: the view state is pinned to { zoom, scrollX: 0, scrollY: 0 } and
 * re-pinned whenever Excalidraw tries to pan or zoom on its own (D3).
 */
export function LiveMarkupLayer(props: LiveMarkupLayerProps) {
  const { page, initialElements, zoom, penMode, readOnly, onElementsChange } = props;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    apiRef.current?.updateScene({ appState: pinnedView(zoom) });
  }, [zoom]);

  return (
    <div className="markup-live" data-live-page={page}>
      <Excalidraw
        initialData={{
          elements: asScene(initialElements),
          appState: {
            ...pinnedView(zoom),
            viewBackgroundColor: "transparent",
            penMode,
            penDetected: penMode,
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

export async function renderStaticPreview(elements: readonly SidecarElement[]): Promise<StaticPreview | null> {
  const rect = overlayBounds(elements);
  if (!rect) return null;
  const svg = await exportToSvg({
    elements: asScene(elements),
    appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false },
    files: null,
    exportPadding: OVERLAY_PADDING_PT,
  });
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "none");
  return { svg: svg.outerHTML, rect };
}

/** Production rasterizer for flattened export (D9): exportToCanvas at 3x, transparent PNG. */
export const rasterizeWithExcalidraw: RasterizePage = async (_page, elements, _size: Size) => {
  const rect = overlayBounds(elements);
  if (!rect) return null;
  const canvas: HTMLCanvasElement = await exportToCanvas({
    elements: asScene(elements),
    appState: { exportBackground: false, viewBackgroundColor: "transparent", exportWithDarkMode: false },
    files: null,
    exportPadding: OVERLAY_PADDING_PT,
    getDimensions: (w: number, h: number) => ({ width: w * EXPORT_RASTER_SCALE, height: h * EXPORT_RASTER_SCALE, scale: EXPORT_RASTER_SCALE }),
  });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b: Blob | null) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
  );
  return { png: new Uint8Array(await blob.arrayBuffer()), rect };
};
