import { describe, expect, it } from "vitest";
import {
  EquationError,
  EquationRenderer,
  isMarkdownElement,
  isRichElement,
  MARKDOWN_KIND,
  richFileId,
  richFiles,
} from "../src/equations/equation";
import { escapeTextMode, inlineToTex, markdownToTex } from "../src/equations/markdown";
import { parseSidecar, serializeSidecar } from "../src/sidecar/schema";
import { element } from "./fixtures/fakes";

const renderer = new EquationRenderer();
const PDF = { fileName: "deck.pdf", pageCount: 3, sha256: "abc" };

describe("Markdown → TeX", () => {
  it("escapes TeX specials so literal text stays literal", () => {
    expect(escapeTextMode("50% of {a} & b_1 #2 $3 ~ ^ \\")).toBe(
      '50\\% of \\{a\\} \\& b\\_1 \\#2 \\$3 {\\char"7E} {\\char"5E} $\\backslash$',
    );
  });

  it("converts inline emphasis, code and math", () => {
    expect(inlineToTex("**bold** and *it* and ***both***")).toBe(
      "\\textbf{bold} and \\textit{it} and \\textbf{\\textit{both}}",
    );
    expect(inlineToTex("__b__ _i_ `a_b{}`")).toBe("\\textbf{b} \\textit{i} \\texttt{a\\_b\\{\\}}");
    expect(inlineToTex("area $\\pi r^2$ and \\(x_1\\)")).toBe("area $\\pi r^2$ and $x_1$");
    expect(inlineToTex("price \\$5, 2 * 3 * 4, snake_case_name")).toBe("price \\$5, 2 * 3 * 4, snake\\_case\\_name");
    expect(inlineToTex("**unclosed")).toBe("**unclosed".replace(/_/g, "\\_"));
  });

  it("builds one left-aligned row per line, with headings, lists, quotes and paragraph gaps", () => {
    const tex = markdownToTex("# Title\n\nFirst line\nsecond line\n- one\n  - nested\n1. first\n> quoted\n");
    expect(tex.startsWith("\\begin{array}{l}")).toBe(true);
    expect(tex).toContain("{\\Large\\text{\\textbf{Title}}}");
    expect(tex).toContain("\\\\[0.6em] \\text{First line}");
    expect(tex).toContain("\\\\ \\text{second line}");
    expect(tex).toContain("\\bullet\\ \\text{one}");
    expect(tex).toContain("\\quad \\bullet\\ \\text{nested}");
    expect(tex).toContain("\\text{1. first}");
    expect(tex).toContain("\\Big|\\ \\text{\\textit{quoted}}");
  });

  it("rejects an empty note", () => {
    expect(() => markdownToTex("  \n \n")).toThrow(/Type some text/);
    expect(() => renderer.renderMarkdown("\n", "#000", 10)).toThrow(EquationError);
  });
});

describe("Markdown note rendering", () => {
  it("renders a mixed note to SVG whose size scales with the font size", () => {
    const md = "## Notes\n**Key:** $e = mc^2$ holds\n- item with `code`\n- 50% done & {braces}";
    const small = renderer.renderMarkdown(md, "#1971c2", 9.8);
    const large = renderer.renderMarkdown(md, "#1971c2", 19.6);
    expect(small.svg.startsWith("<svg")).toBe(true);
    expect(small.svg).toContain("#1971c2");
    expect(large.width).toBeCloseTo(small.width * 2, 0);
    expect(small.height).toBeGreaterThan(small.width / 20);
  });

  it("surfaces bad inline math as an error", () => {
    expect(() => renderer.renderMarkdown("ok $\\frac{1}$", "#000", 10)).toThrow(/Missing argument/);
  });
});

describe("Markdown notes in the sidecar", () => {
  const note = (markdown: string) =>
    element("n1", {
      type: "image",
      fileId: richFileId({ kind: MARKDOWN_KIND, markdown, color: "#1e1e1e", fontSize: 9.8 }),
      status: "saved",
      customData: { kind: MARKDOWN_KIND, markdown, color: "#1e1e1e", fontSize: 9.8 },
    });

  it("round-trips the Markdown source and regenerates its file", () => {
    const n = note("**hello** $x$");
    expect(isMarkdownElement(n)).toBe(true);
    expect(isRichElement(n)).toBe(true);
    const text = serializeSidecar({ schemaVersion: 1, pdf: PDF, pages: new Map([[2, [n]]]) });
    const back = parseSidecar(text, PDF);
    expect(back.status).toBe("ok");
    expect(back.sidecar.pages.get(2)?.[0]?.customData).toEqual(n.customData);
    expect(JSON.parse(text).files).toBeUndefined();
    expect(Object.keys(richFiles(renderer, [n]))).toEqual([n.fileId]);
  });

  it("rejects malformed note data", () => {
    const bad = element("n2", { type: "image", customData: { kind: "markdown", markdown: "x", color: "#000", fontSize: 0 } });
    expect(isRichElement(bad)).toBe(false);
    const r = parseSidecar(JSON.stringify({ schemaVersion: 1, pages: { "1": { elements: [bad] } } }), PDF);
    expect(r.sidecar.pages.size).toBe(0);
  });
});
