/**
 * Lightweight equation helpers (no MathJax import) shared by the sidecar schema and the renderer.
 * An equation is an Excalidraw image element with customData { kind: "equation", latex, color };
 * its picture is regenerated from the LaTeX, so the sidecar never stores image files (D7).
 */

export const EQUATION_KIND = "equation";

export interface EquationData {
  kind: typeof EQUATION_KIND;
  latex: string;
  color: string;
}

/** Strips one pair of math delimiters: $…$, $$…$$, \(…\), \[…\]. */
export function normalizeLatex(input: string): string {
  let s = input.trim();
  const pairs: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [open, close] of pairs) {
    if (s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  return s;
}

/** Deterministic id for an equation's rendered file (FNV-1a over latex + color). */
export function equationFileId(latex: string, color: string): string {
  let h = 0x811c9dc5;
  const text = `${color}\u0000${latex}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `eq-${h.toString(16).padStart(8, "0")}-${text.length}`;
}

export function isEquationElement(el: unknown): el is { id: string; type: "image"; customData: EquationData; [k: string]: unknown } {
  if (typeof el !== "object" || el === null) return false;
  const e = el as { type?: unknown; customData?: unknown };
  if (e.type !== "image" || typeof e.customData !== "object" || e.customData === null) return false;
  const d = e.customData as Partial<EquationData>;
  return d.kind === EQUATION_KIND && typeof d.latex === "string" && typeof d.color === "string";
}

