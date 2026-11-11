/**
 * Coordinate model.
 *
 * Stored Excalidraw coordinates are PDF points at scale 1.0, origin at the top-left of the page as
 * displayed (rotation applied) — D6. Zoom only changes the mapping to screen pixels; it never touches the
 * stored scene. The live Excalidraw instance is sized to the page box and given
 * { zoom: { value: zoom }, scrollX: 0, scrollY: 0 }, which makes Excalidraw's own scene→viewport mapping
 * identical to pageToViewport below.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** Converts a viewport (client) point to normalized page points. `pageOrigin` is the page's top-left in client px. */
export function viewportToPage(client: Point, pageOrigin: Point, zoom: number): Point {
  assertZoom(zoom);
  return { x: (client.x - pageOrigin.x) / zoom, y: (client.y - pageOrigin.y) / zoom };
}

/** Converts normalized page points back to a viewport (client) point. */
export function pageToViewport(page: Point, pageOrigin: Point, zoom: number): Point {
  assertZoom(zoom);
  return { x: page.x * zoom + pageOrigin.x, y: page.y * zoom + pageOrigin.y };
}

/** The appState the single live Excalidraw instance must use so scene coords == page points. */
export function excalidrawViewState(zoom: number): { zoom: { value: number }; scrollX: 0; scrollY: 0 } {
  assertZoom(zoom);
  return { zoom: { value: zoom }, scrollX: 0, scrollY: 0 };
}

/**
 * Excalidraw's own scene→viewport formula (viewportCoordsToSceneCoords inverse):
 *   clientX = (sceneX + scrollX) * zoom + offsetLeft
 * Kept here so a test can prove the pinned view state reproduces pageToViewport exactly.
 */
export function excalidrawSceneToViewport(
  scene: Point,
  view: { zoom: { value: number }; scrollX: number; scrollY: number },
  offset: Point,
): Point {
  return {
    x: (scene.x + view.scrollX) * view.zoom.value + offset.x,
    y: (scene.y + view.scrollY) * view.zoom.value + offset.y,
  };
}

export function excalidrawViewportToScene(
  client: Point,
  view: { zoom: { value: number }; scrollX: number; scrollY: number },
  offset: Point,
): Point {
  return {
    x: (client.x - offset.x) / view.zoom.value - view.scrollX,
    y: (client.y - offset.y) / view.zoom.value - view.scrollY,
  };
}

function assertZoom(zoom: number): void {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError(`invalid zoom: ${zoom}`);
}

// ---- PDF user space (for pdf-lib export) ----------------------------------------------------------

export type PageRotation = 0 | 90 | 180 | 270;

export function normalizeRotation(degrees: number): PageRotation {
  const r = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return r as PageRotation;
}

/** Page box in unrotated PDF user space (origin bottom-left). */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Displayed size of a page box once /Rotate is applied. */
export function displayedSize(box: PageBox, rotation: PageRotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/** Maps a displayed point (top-left origin, rotation applied) to unrotated PDF user space. */
export function displayedToUserSpace(p: Point, box: PageBox, rotation: PageRotation): Point {
  const { x: bx, y: by, width: W, height: H } = box;
  switch (rotation) {
    case 0:
      return { x: bx + p.x, y: by + H - p.y };
    case 90:
      return { x: bx + p.y, y: by + p.x };
    case 180:
      return { x: bx + W - p.x, y: by + p.y };
    case 270:
      return { x: bx + W - p.y, y: by + H - p.x };
  }
}

/**
 * Where to draw an overlay image covering `rect` (displayed coords) with pdf-lib's drawImage:
 * lower-left anchor in user space, the image's own width/height, and a counter-clockwise rotation that
 * cancels the page's /Rotate so the overlay appears upright in any viewer.
 */
export interface OverlayPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotateDegrees: number;
}

export function overlayPlacement(rect: Rect, box: PageBox, rotation: PageRotation): OverlayPlacement {
  const anchor = displayedToUserSpace({ x: rect.x, y: rect.y + rect.height }, box, rotation);
  return { x: anchor.x, y: anchor.y, width: rect.width, height: rect.height, rotateDegrees: rotation };
}
