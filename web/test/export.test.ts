import { degrees, PDFDocument, PDFName, PDFDict, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { flattenPdf, markedFileName, type RasterizePage } from "../src/export/flatten";
import type { SidecarElement } from "../src/sidecar/schema";
import { element } from "./fixtures/fakes";

// 1×1 transparent PNG (stands in for Excalidraw exportToCanvas output in headless tests).
const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

async function fixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const sizes: Array<[number, number, number]> = [
    [960, 540, 0],
    [720, 540, 0],
    [612, 792, 90],
    [842, 595, 0],
    [612, 792, 180],
  ];
  for (const [w, h, rot] of sizes) {
    const page = doc.addPage([w, h]);
    page.drawRectangle({ x: 20, y: 20, width: 100, height: 60, color: rgb(0.2, 0.4, 0.8) });
    page.setRotation(degrees(rot));
  }
  return doc.save({ useObjectStreams: false });
}

function imageXObjectCount(doc: PDFDocument, pageIndex: number): number {
  const page = doc.getPage(pageIndex);
  const resources = page.node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return 0;
  return xobjects.keys().filter((k) => {
    const obj = xobjects.lookup(k);
    return obj && "dict" in obj && (obj as { dict: PDFDict }).dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  }).length;
}

const rasterize: RasterizePage = async (_page, _elements, size) => ({
  png: PNG_1x1,
  rect: { x: 5, y: 5, width: Math.min(100, size.width - 10), height: Math.min(80, size.height - 10) },
});

describe("flattened export with pdf-lib (D9)", () => {
  it("keeps the page count, leaves the original bytes untouched, and overlays only annotated pages", async () => {
    const original = await fixturePdf();
    const snapshot = original.slice();
    const pages = new Map<number, readonly SidecarElement[]>([
      [1, [element("a")]],
      [3, [element("b"), element("c")]],
      [5, [element("d")]],
      [4, []],
    ]);

    const { bytes, annotatedPages } = await flattenPdf(original, pages, rasterize);

    expect(original).toEqual(snapshot); // untouched input
    expect(annotatedPages).toEqual([1, 3, 5]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

    const out = await PDFDocument.load(bytes);
    const src = await PDFDocument.load(original);
    expect(out.getPageCount()).toBe(src.getPageCount());
    for (let i = 0; i < out.getPageCount(); i++) {
      expect(out.getPage(i).getSize()).toEqual(src.getPage(i).getSize());
      expect(out.getPage(i).getRotation().angle).toBe(src.getPage(i).getRotation().angle);
      const expected = annotatedPages.includes(i + 1) ? 1 : 0;
      expect(imageXObjectCount(out, i)).toBe(expected);
    }
  });

  it("returns an equivalent document when nothing is annotated", async () => {
    const original = await fixturePdf();
    const { bytes, annotatedPages } = await flattenPdf(original, new Map(), rasterize);
    expect(annotatedPages).toEqual([]);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(5);
    for (let i = 0; i < 5; i++) expect(imageXObjectCount(out, i)).toBe(0);
  });

  it("ignores sidecar pages beyond the PDF's page count and pages the rasterizer skips", async () => {
    const original = await fixturePdf();
    const pages = new Map<number, readonly SidecarElement[]>([
      [2, [element("x")]],
      [42, [element("orphan")]],
    ]);
    const { annotatedPages } = await flattenPdf(original, pages, async () => null);
    expect(annotatedPages).toEqual([]);
    const { annotatedPages: second } = await flattenPdf(original, pages, rasterize);
    expect(second).toEqual([2]);
  });

  it("names the export <name>-marked.pdf", () => {
    expect(markedFileName("deck.pdf")).toBe("deck-marked.pdf");
    expect(markedFileName("Week 3.PDF")).toBe("Week 3-marked.pdf");
    expect(markedFileName("noext")).toBe("noext-marked.pdf");
  });
});
