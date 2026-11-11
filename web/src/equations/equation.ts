import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor, type LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import type { MathDocument } from "mathjax-full/js/core/MathDocument.js";
import type { LiteElement } from "mathjax-full/js/adaptors/lite/Element.js";
import { equationFileId, isRichElement, normalizeLatex, richFileId, type RichData } from "./equationData";
import { MarkdownError, markdownToTex } from "./markdown";

export * from "./equationData";
export { MarkdownError, markdownToTex } from "./markdown";

/**
 * LaTeX equations as markup.
 *
 * An equation is an Excalidraw image element whose picture is regenerated from its LaTeX source:
 *   customData: { kind: "equation", latex, color }, fileId: "eq-<hash(latex,color)>"
 * The sidecar keeps only the element (no files map — D7); the SVG is rendered locally by MathJax
 * (bundled fonts, no network) whenever the scene is shown or exported.
 */

/** Equation font size in page points (matches the "medium" text size after the 0.7 scaling). */
export const EQUATION_FONT_PT = 14;
/** MathJax's ex height relative to the em (TeX fonts: x-height ≈ 0.431 em). */
const EX_PER_EM = 0.431;
export const DEFAULT_EQUATION_COLOR = "#1e1e1e";

export interface RenderedEquation {
  svg: string;
  dataURL: string;
  /** Natural size in page points. */
  width: number;
  height: number;
}

export class EquationError extends Error {
  override name = "EquationError";
}

/**
 * TeX → standalone SVG with MathJax (liteAdaptor: identical output in the browser and in Node tests).
 * One instance per app; renders are cached by file id.
 */
export class EquationRenderer {
  private adaptor: LiteAdaptor | null = null;
  private doc: MathDocument<unknown, unknown, unknown> | null = null;
  private readonly cache = new Map<string, RenderedEquation>();

  private ensure(): { adaptor: LiteAdaptor; doc: MathDocument<unknown, unknown, unknown> } {
    if (!this.adaptor || !this.doc) {
      this.adaptor = liteAdaptor();
      RegisterHTMLHandler(this.adaptor);
      this.doc = mathjax.document("", {
        InputJax: new TeX({ packages: AllPackages }),
        OutputJax: new SVG({ fontCache: "none" }),
      }) as MathDocument<unknown, unknown, unknown>;
    }
    return { adaptor: this.adaptor, doc: this.doc };
  }

  /** Throws EquationError with MathJax's message for invalid TeX. */
  render(rawLatex: string, color = DEFAULT_EQUATION_COLOR): RenderedEquation {
    const latex = normalizeLatex(rawLatex);
    if (latex === "") throw new EquationError("Type an equation");
    return this.renderTex(latex, color, EQUATION_FONT_PT, equationFileId(latex, color));
  }

  /** Markdown note → SVG at `fontSize` points. Throws EquationError for empty notes or bad inline math. */
  renderMarkdown(markdown: string, color: string, fontSize: number): RenderedEquation {
    let tex: string;
    try {
      tex = markdownToTex(markdown);
    } catch (e) {
      throw new EquationError(e instanceof MarkdownError ? e.message : String(e));
    }
    return this.renderTex(tex, color, fontSize, richFileId({ kind: "markdown", markdown, color, fontSize }));
  }

  renderRich(data: RichData): RenderedEquation {
    return data.kind === "equation" ? this.render(data.latex, data.color) : this.renderMarkdown(data.markdown, data.color, data.fontSize);
  }

  private renderTex(tex: string, color: string, fontPt: number, key: string): RenderedEquation {
    const hit = this.cache.get(key);
    if (hit) return hit;

    const { adaptor, doc } = this.ensure();
    const node = doc.convert(tex, { display: true, em: 16, ex: 8, containerWidth: 1280 }) as LiteElement;
    const html = adaptor.outerHTML(node);
    const err = /data-mjx-error="([^"]*)"/.exec(html);
    if (err) throw new EquationError(decodeEntities(err[1] ?? "Invalid LaTeX"));

    const svgNode = adaptor.firstChild(node) as LiteElement;
    const wEx = parseFloat(adaptor.getAttribute(svgNode, "width") ?? "");
    const hEx = parseFloat(adaptor.getAttribute(svgNode, "height") ?? "");
    if (!Number.isFinite(wEx) || !Number.isFinite(hEx) || wEx <= 0 || hEx <= 0) throw new EquationError("Empty equation");
    const exPt = fontPt * EX_PER_EM;
    const width = round2(wEx * exPt);
    const height = round2(hEx * exPt);
    adaptor.setAttribute(svgNode, "width", `${width}pt`);
    adaptor.setAttribute(svgNode, "height", `${height}pt`);
    adaptor.setAttribute(svgNode, "style", `color:${color}`);
    adaptor.setAttribute(svgNode, "xmlns", "http://www.w3.org/2000/svg");
    const svg = adaptor.outerHTML(svgNode).replace(/currentColor/g, color);
    const rendered: RenderedEquation = { svg, dataURL: `data:image/svg+xml;base64,${utf8ToBase64(svg)}`, width, height };
    this.cache.set(key, rendered);
    return rendered;
  }
}

/** Excalidraw BinaryFiles entry for a rich element (regenerated, never persisted). */
export function richFile(renderer: EquationRenderer, data: RichData) {
  const r = renderer.renderRich(data);
  return { id: richFileId(data), mimeType: "image/svg+xml" as const, dataURL: r.dataURL, created: 0 };
}

/** Files map for every equation / Markdown note in `elements` (skips ones whose source no longer renders). */
export function richFiles(renderer: EquationRenderer, elements: readonly unknown[]): Record<string, ReturnType<typeof richFile>> {
  const files: Record<string, ReturnType<typeof richFile>> = {};
  for (const el of elements) {
    if (!isRichElement(el)) continue;
    try {
      const f = richFile(renderer, el.customData);
      files[f.id] = f;
    } catch {
      // A broken element still shows as Excalidraw's empty-image placeholder; its source is kept.
    }
  }
  return files;
}

/** Back-compat names (v1.0.3). */
export const equationFile = richFile;
export const equationFiles = richFiles;

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodeEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
