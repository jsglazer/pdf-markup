import { useEffect, useRef } from "react";
import type { Size } from "../geometry/coords";
import type { PdfDocumentSource } from "../pdf/pdfSource";
import { canvasRenderSize } from "../virtualization/layout";

interface Props {
  source: PdfDocumentSource;
  page: number;
  sizePt: Size;
  zoom: number;
  devicePixelRatio: number;
}

/**
 * One PDF.js canvas. It exists only while its page is inside the render window; unmounting cancels the
 * render and zeroes the canvas so WebKit releases its backing store (D12).
 */
export function PdfPageCanvas({ source, page, sizePt, zoom, devicePixelRatio }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const { width, height, renderScale } = canvasRenderSize(sizePt, zoom, devicePixelRatio);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    let cancelTask: (() => void) | null = null;
    canvas.width = width;
    canvas.height = height;
    void source.getPage(page).then((handle) => {
      if (cancelled) return;
      const task = handle.render(canvas, renderScale);
      cancelTask = task.cancel;
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancelTask?.();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [source, page, width, height, renderScale]);

  return <canvas ref={ref} className="pdf-canvas" data-pdf-canvas={page} />;
}
