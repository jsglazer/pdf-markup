import type { PointerEvent as ReactPointerEvent } from "react";
import { LiveMarkupLayer } from "../excalidraw/adapter";
import type { PdfDocumentSource } from "../pdf/pdfSource";
import type { SidecarElement } from "../sidecar/schema";
import type { DocumentLayout } from "../virtualization/layout";
import type { Mode } from "../controller/documentController";
import { PdfPageCanvas } from "./PdfPageCanvas";
import type { PreviewCache } from "./previewCache";
import { StaticOverlay } from "./StaticOverlay";

/**
 * The ONE place that decides which page may host a live Excalidraw instance (D5):
 * reading mode → none; markup mode → exactly the active page. Every page in the list loop compares its
 * number against this single value, so at most one LiveMarkupLayer can ever mount.
 */
export function selectLivePage(mode: Mode, activePage: number | null): number | null {
  return mode === "markup" ? activePage : null;
}

export interface DocumentViewProps {
  source: PdfDocumentSource;
  layout: DocumentLayout;
  /** Inclusive render window from renderWindow(); pages outside it are not in the DOM at all (D12). */
  range: { first: number; last: number } | null;
  mode: Mode;
  activePage: number | null;
  readOnly: boolean;
  penMode: boolean;
  sceneEpoch: number;
  devicePixelRatio: number;
  previewCache: PreviewCache;
  elementsFor: (page: number) => readonly SidecarElement[];
  revisionFor: (page: number) => number;
  onElementsChange: (page: number, elements: readonly unknown[]) => void;
  /** Pencil-down (or mouse-down on macOS) on a non-live page in markup mode moves the live instance there. */
  onActivatePage: (page: number) => void;
}

export function DocumentView(props: DocumentViewProps) {
  const { layout, range, mode, activePage, previewCache } = props;
  const zoom = layout.scale;
  const livePage = selectLivePage(mode, activePage);
  const slots = range ? layout.slots.slice(range.first - 1, range.last) : [];

  return (
    <div
      className="page-stack"
      data-testid="page-stack"
      style={{ width: layout.contentWidth, height: layout.contentHeight }}
    >
      {slots.map((slot) => {
        const isLive = slot.page === livePage; // guard: only the single selected page may mount Excalidraw
        const onPointerDown =
          mode === "markup" && !isLive
            ? (e: ReactPointerEvent) => {
                if (e.pointerType === "pen" || e.pointerType === "mouse") props.onActivatePage(slot.page);
              }
            : undefined;
        const sizePt = props.source.pageSizes[slot.page - 1];
        if (!sizePt) return null;
        return (
          <div
            key={slot.page}
            className="page"
            data-page={slot.page}
            style={{ top: slot.top, left: slot.left, width: slot.width, height: slot.height }}
            onPointerDown={onPointerDown}
          >
            <PdfPageCanvas
              source={props.source}
              page={slot.page}
              sizePt={sizePt}
              zoom={zoom}
              devicePixelRatio={props.devicePixelRatio}
            />
            {isLive ? (
              <LiveMarkupLayer
                key={`live-${slot.page}-${props.sceneEpoch}`}
                page={slot.page}
                initialElements={props.elementsFor(slot.page)}
                zoom={zoom}
                penMode={props.penMode}
                readOnly={props.readOnly}
                onElementsChange={props.onElementsChange}
              />
            ) : (
              <StaticOverlay
                page={slot.page}
                revision={props.revisionFor(slot.page)}
                elements={props.elementsFor(slot.page)}
                zoom={zoom}
                cache={previewCache}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
