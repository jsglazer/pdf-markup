import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Size } from "../geometry/coords";
import type { OpenPdf, PdfDocumentSource, PdfPageHandle } from "./pdfSource";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** All PDF.js data files are bundled under ./pdfjs/ by vite.config.ts — nothing is fetched remotely. */
function localAsset(path: string): string {
  return new URL(path, document.baseURI).href;
}

export const openPdfWithPdfjs: OpenPdf = async (url) => {
  const task = pdfjs.getDocument({
    url,
    cMapUrl: localAsset("./pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: localAsset("./pdfjs/standard_fonts/"),
    wasmUrl: localAsset("./pdfjs/wasm/"),
    iccUrl: localAsset("./pdfjs/iccs/"),
    // The scheme handler serves the whole file in one response.
    disableRange: true,
    disableStream: true,
    enableXfa: false,
  });
  const doc = await task.promise;
  const pageSizes: Size[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 }); // rotation applied → displayed points (D6)
    pageSizes.push({ width: vp.width, height: vp.height });
    page.cleanup();
  }
  return new PdfjsDocumentSource(doc, pageSizes, () => void task.destroy());
};

class PdfjsDocumentSource implements PdfDocumentSource {
  constructor(
    private readonly doc: pdfjs.PDFDocumentProxy,
    readonly pageSizes: readonly Size[],
    private readonly destroyTask: () => void,
  ) {}

  async getPage(pageNumber: number): Promise<PdfPageHandle> {
    const page = await this.doc.getPage(pageNumber);
    return {
      render(canvas, renderScale) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return { promise: Promise.reject(new Error("no 2d context")), cancel: () => undefined };
        const task = page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale: renderScale }) });
        return {
          promise: task.promise.then(() => undefined),
          cancel: () => {
            task.cancel();
            page.cleanup();
          },
        };
      },
    };
  }

  getData(): Promise<Uint8Array> {
    return this.doc.getData();
  }

  destroy(): void {
    void this.doc.cleanup();
    this.destroyTask();
  }
}
