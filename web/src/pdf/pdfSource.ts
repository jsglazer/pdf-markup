import type { Size } from "../geometry/coords";

/** A running render; cancel() releases it when the page scrolls out of the render window. */
export interface PageRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

export interface PdfPageHandle {
  /** Renders at `renderScale` device pixels per page point into `canvas` (already sized by the caller). */
  render(canvas: HTMLCanvasElement, renderScale: number): PageRenderTask;
}

/**
 * Renderer-agnostic document handle. Production: PdfjsDocumentSource. Tests: a fake with fixed page
 * sizes, so layout, virtualization and mounting run without PDF.js or a canvas implementation.
 */
export interface PdfDocumentSource {
  /** Displayed size (rotation applied) of each page, in PDF points; index i = page i+1. */
  readonly pageSizes: readonly Size[];
  getPage(pageNumber: number): Promise<PdfPageHandle>;
  /** Original PDF bytes, for flattened export. */
  getData(): Promise<Uint8Array>;
  destroy(): void;
}

export type OpenPdf = (url: string) => Promise<PdfDocumentSource>;
