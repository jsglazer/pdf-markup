import type { Platform } from "../bridge/protocol";
import type { Mode } from "../controller/documentController";

/**
 * Input routing (D3, D4) — pure decisions, so they are testable without a browser.
 *
 * - iPad markup mode: Apple Pencil draws (Excalidraw penMode); finger touches never reach Excalidraw —
 *   they pan the document scroller, and two-finger pinch zooms through the ZoomController.
 * - macOS markup mode: mouse/trackpad draws; scroll wheel scrolls the document; ctrl+wheel (trackpad
 *   pinch) zooms through the ZoomController.
 * - Excalidraw never receives wheel or gesture events, so it can never pan or zoom on its own.
 */

export type PointerRoute = "excalidraw" | "documentPan" | "native";

export function routePointer(pointerType: string, platform: Platform, mode: Mode): PointerRoute {
  if (mode !== "markup") return "native";
  if (pointerType === "touch") return platform === "macos" ? "native" : "documentPan";
  return "excalidraw";
}

/** Wheel events over the live layer: ctrl+wheel → our zoom; plain wheel → document scroll. Never Excalidraw. */
export type WheelRoute = "zoom" | "documentScroll";

export function routeWheel(ctrlKey: boolean): WheelRoute {
  return ctrlKey ? "zoom" : "documentScroll";
}

/** Converts a ctrl+wheel deltaY (trackpad pinch on macOS WebKit) to a multiplicative zoom factor. */
export function wheelZoomFactor(deltaY: number): number {
  const clamped = Math.max(-50, Math.min(50, deltaY));
  return Math.exp(-clamped / 100);
}

/** Tracks single-finger pans forwarded to the document scroller. */
export class FingerPan {
  private readonly pointers = new Map<number, { x: number; y: number }>();

  start(id: number, x: number, y: number): void {
    this.pointers.set(id, { x, y });
  }

  /** Returns the scroll delta for this move, or null when it is not a single-finger pan. */
  move(id: number, x: number, y: number): { dx: number; dy: number } | null {
    const prev = this.pointers.get(id);
    if (!prev) return null;
    this.pointers.set(id, { x, y });
    if (this.pointers.size !== 1) return null; // two fingers: the pinch gesture owns this
    return { dx: prev.x - x, dy: prev.y - y };
  }

  end(id: number): void {
    this.pointers.delete(id);
  }

  get activeCount(): number {
    return this.pointers.size;
  }
}
