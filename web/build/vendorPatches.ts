/**
 * Build-time patches to the Excalidraw production bundle. Each patch must match EXACTLY `expected`
 * times across the vendor chunks, or the build fails — an Excalidraw upgrade that moves a pattern can
 * never silently drop a patch. `test/offline.test.ts` checks every pattern against the installed bundle.
 */

export interface VendorPatch {
  name: string;
  pattern: RegExp; // must be global
  replace: string | ((match: string, ...groups: string[]) => string);
  expected: number;
}

/** Freehand ("pencil") strokes render at this fraction of Excalidraw's default width. */
export const FREEDRAW_WIDTH_FACTOR = 0.5;
/** Text font sizes (S/M/L/XL picker and the default) are scaled by this factor. */
export const FONT_SIZE_FACTOR = 0.7;
/** Excalidraw's default text size (medium, 20) after scaling. */
export const DEFAULT_TEXT_SIZE = 20 * FONT_SIZE_FACTOR;

const round = (n: number) => Math.round(n * 1000) / 1000;

export const VENDOR_PATCHES: VendorPatch[] = [
  {
    // Excalidraw appends an esm.sh CDN fallback to every font URL; point it at the app's own origin.
    // Lazy match: the ${...} expression itself contains nested template literals.
    name: "esm.sh font fallback → local origin",
    pattern: /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/gs,
    replace: '(typeof document<"u"?new URL("./",document.baseURI).href:"pdfmarkup://app/")',
    expected: 1,
  },
  {
    // perfect-freehand size for freedraw elements (used by the canvas renderer, SVG export and canvas
    // export alike), so existing and new pencil strokes all render thinner. Stored strokeWidth is unchanged.
    name: "freedraw stroke size × 0.5",
    pattern: /size:([a-zA-Z_$][\w$]*)\.strokeWidth\*4\.25/g,
    replace: (_m, el) => `size:${el}.strokeWidth*${round(4.25 * FREEDRAW_WIDTH_FACTOR)}`,
    expected: 1,
  },
  {
    // The four font-size picker buttons (small/medium/large/veryLarge).
    name: "font size picker × 0.7",
    pattern: /\{value:(16|20|28|36),text:([a-zA-Z_$][\w$]*)\("labels\.(small|medium|large|veryLarge)"\)/g,
    replace: (_m, size, t, label) => `{value:${round(Number(size) * FONT_SIZE_FACTOR)},text:${t}("labels.${label}")`,
    expected: 4,
  },
];

/** Applies every patch to one module's code; returns the new code and the per-patch match counts. */
export function applyVendorPatches(code: string): { code: string; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  let out = code;
  for (const p of VENDOR_PATCHES) {
    const n = out.match(p.pattern)?.length ?? 0;
    counts.set(p.name, n);
    if (n > 0) out = out.replace(p.pattern, p.replace as (substring: string, ...args: string[]) => string);
  }
  return { code: out, counts };
}
