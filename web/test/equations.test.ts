import { describe, expect, it, vi } from "vitest";
import { createMemoryTransportPair } from "../src/bridge/transport";
import { DocumentController } from "../src/controller/documentController";
import {
  EQUATION_KIND,
  EquationError,
  EquationRenderer,
  equationFileId,
  equationFiles,
  isEquationElement,
  normalizeLatex,
} from "../src/equations/equation";
import { parseSidecar, serializeSidecar } from "../src/sidecar/schema";
import { element, FakeScheduler, fakePdfSource, hundredPageSizes } from "./fixtures/fakes";

const PDF = { fileName: "deck.pdf", pageCount: 3, sha256: "abc" };
const renderer = new EquationRenderer();

function equationElement(latex: string, color = "#1e1e1e") {
  return element("eq1", {
    type: "image",
    fileId: equationFileId(latex, color),
    status: "saved",
    customData: { kind: EQUATION_KIND, latex, color },
  });
}

describe("LaTeX input", () => {
  it("strips one pair of math delimiters", () => {
    expect(normalizeLatex("$e = {mc}^2 + \\dfrac{1}{5}$")).toBe("e = {mc}^2 + \\dfrac{1}{5}");
    expect(normalizeLatex("  $$x^2$$ ")).toBe("x^2");
    expect(normalizeLatex("\\(a+b\\)")).toBe("a+b");
    expect(normalizeLatex("\\[ \\sum_i x_i \\]")).toBe("\\sum_i x_i");
    expect(normalizeLatex("x^2")).toBe("x^2");
    expect(normalizeLatex("$")).toBe("$");
  });
});

describe("EquationRenderer (MathJax, offline)", () => {
  it("renders the example equation to a standalone SVG sized in page points", () => {
    const r = renderer.render("$e = {mc}^2 + \\dfrac{1}{5}$", "#e03131");
    expect(r.svg.startsWith("<svg")).toBe(true);
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.svg).toContain("#e03131");
    expect(r.svg).not.toContain("currentColor");
    expect(r.svg).not.toMatch(/<image|href="http/); // self-contained glyph paths, no external refs
    expect(r.dataURL.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(r.width).toBeGreaterThan(r.height);
    expect(r.height).toBeGreaterThan(10); // \dfrac makes it taller than one line of 14 pt text
  });

  it("is deterministic and cached per LaTeX + colour", () => {
    const a = renderer.render("x^2");
    expect(renderer.render("$x^2$")).toBe(a);
    expect(renderer.render("x^2", "#2f9e44")).not.toBe(a);
    expect(equationFileId("x^2", "#000")).toBe(equationFileId("x^2", "#000"));
    expect(equationFileId("x^2", "#000")).not.toBe(equationFileId("x^2", "#111"));
  });

  it("reports TeX errors instead of rendering them", () => {
    expect(() => renderer.render("\\frac{1}")).toThrow(EquationError);
    expect(() => renderer.render("\\frac{1}")).toThrow(/Missing argument for \\frac/);
    expect(() => renderer.render("  $ $ ")).toThrow(/Type an equation/);
  });

  it("builds the files map for equations only, keyed by their file ids", () => {
    const eq = equationElement("a^2+b^2=c^2");
    const files = equationFiles(renderer, [eq, element("rect"), equationElement("\\frac{1}")]);
    expect(Object.keys(files)).toEqual([eq.fileId]);
    expect(files[eq.fileId as string]?.mimeType).toBe("image/svg+xml");
  });
});

describe("equations in the sidecar (D7 exception)", () => {
  it("keeps equation elements with their LaTeX and never writes a files map", () => {
    const eq = equationElement("e = {mc}^2");
    const text = serializeSidecar({ schemaVersion: 1, pdf: PDF, pages: new Map([[1, [eq, element("r")]]]) });
    const raw = JSON.parse(text);
    expect(raw.files).toBeUndefined();
    expect(raw.pages["1"].elements[0].customData).toEqual({ kind: "equation", latex: "e = {mc}^2", color: "#1e1e1e" });
    const back = parseSidecar(text, PDF);
    expect(back.status).toBe("ok");
    expect(back.sidecar.pages.get(1)?.filter(isEquationElement)).toHaveLength(1);
  });

  it("still drops ordinary image elements", () => {
    const text = JSON.stringify({ schemaVersion: 1, pages: { "1": { elements: [element("img", { type: "image", fileId: "x" })] } } });
    const r = parseSidecar(text, PDF);
    expect(r.sidecar.pages.size).toBe(0);
    expect(r.warnings[0]).toMatch(/image/);
  });
});

describe("DocumentController equation / Markdown commands", () => {
  it("inserts or edits through the live editor and reports availability", async () => {
    const pair = createMemoryTransportPair();
    const controller = new DocumentController({
      transport: pair.web,
      openPdf: async () => fakePdfSource(hundredPageSizes()),
      rasterize: async () => null,
      scheduler: new FakeScheduler(),
    });
    controller.start();
    expect(controller.commitRich("equation", "x", null)).toBe(false); // no live editor yet

    const handle = { insertRich: vi.fn(), updateRich: vi.fn() };
    controller.setLiveEditor(handle);
    expect(controller.getState().canInsertRich).toBe(true);
    expect(controller.commitRich("equation", "x^2", null)).toBe(true);
    expect(handle.insertRich).toHaveBeenCalledWith("equation", "x^2");
    controller.commitRich("markdown", "**hi**", null);
    expect(handle.insertRich).toHaveBeenCalledWith("markdown", "**hi**");

    controller.setSelectedRich({ id: "n1", kind: "markdown", source: "**hi**" });
    expect(controller.getState().selectedRich).toEqual({ id: "n1", kind: "markdown", source: "**hi**" });
    const before = controller.getState().richEditRequest;
    controller.requestRichEdit();
    expect(controller.getState().richEditRequest).toBe(before + 1);
    controller.commitRich("markdown", "**bye**", "n1");
    expect(handle.updateRich).toHaveBeenCalledWith("n1", "**bye**");

    controller.setLiveEditor(null);
    expect(controller.getState().canInsertRich).toBe(false);
  });
});
