import { degrees, PDFDocument } from "pdf-lib";
import { normalizeRotation, overlayPlacement, type PageBox, type Rect, type Size } from "../geometry/coords";
import type { SidecarElement } from "../sidecar/schema";

/**
 * Flattened export (D9). Each annotated page's overlay is rasterized (production: Excalidraw
 * exportToCanvas at 3x ≈ 216 dpi, transparent PNG, cropped to the elements' bounds) and drawn over the
 * page with pdf-lib. Unannotated pages are copied unchanged. The input bytes are never modified.
 */

export const EXPORT_RASTER_SCALE = 3;

export interface PageOverlayRaster {
  png: Uint8Array;
  /** Area the PNG covers, in displayed page points (top-left origin). */
  rect: Rect;
}

/** Injected rasterizer: production wraps Excalidraw exportToCanvas; tests return a fixed PNG. */
export type RasterizePage = (
  page: number,
  elements: readonly SidecarElement[],
  displayedPageSize: Size,
) => Promise<PageOverlayRaster | null>;

export interface FlattenResult {
  bytes: Uint8Array;
  annotatedPages: number[];
}

export async function flattenPdf(
  originalBytes: Uint8Array,
  pages: ReadonlyMap<number, readonly SidecarElement[]>,
  rasterize: RasterizePage,
): Promise<FlattenResult> {
  // Work on a private copy so the caller's buffer is provably untouched.
  const doc = await PDFDocument.load(originalBytes.slice(), { updateMetadata: false });
  const pdfPages = doc.getPages();
  const annotatedPages: number[] = [];

  for (const [pageNumber, elements] of [...pages.entries()].sort(([a], [b]) => a - b)) {
    if (elements.length === 0) continue;
    const page = pdfPages[pageNumber - 1];
    if (!page) continue; // Orphan page (PDF has fewer pages than the sidecar): nothing to draw on.
    const crop = page.getCropBox();
    const box: PageBox = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
    const rotation = normalizeRotation(page.getRotation().angle);
    const displayed =
      rotation === 90 || rotation === 270
        ? { width: box.height, height: box.width }
        : { width: box.width, height: box.height };
    const raster = await rasterize(pageNumber, elements, displayed);
    if (!raster) continue;
    const image = await doc.embedPng(raster.png);
    const place = overlayPlacement(raster.rect, box, rotation);
    page.drawImage(image, {
      x: place.x,
      y: place.y,
      width: place.width,
      height: place.height,
      rotate: degrees(place.rotateDegrees),
    });
    annotatedPages.push(pageNumber);
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, annotatedPages };
}

/** deck.pdf → deck-marked.pdf (D9). */
export function markedFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "");
  return `${base || "document"}-marked.pdf`;
}

/** Chunked base64 so large exports do not blow the argument limit of String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
