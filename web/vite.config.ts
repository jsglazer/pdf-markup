/// <reference types="vitest/config" />
import { cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const excalidrawDist = resolve(here, "node_modules/@excalidraw/excalidraw/dist/prod");
const pdfjsRoot = resolve(here, "node_modules/pdfjs-dist");

/**
 * Excalidraw always appends a CDN fallback (esm.sh) after the configured EXCALIDRAW_ASSET_PATH when it
 * builds font URLs. This transform rewrites that one template literal to the app's own origin, so the
 * shipped bundle has no CDN URL at all. The build fails if the pattern is not found exactly once, so an
 * Excalidraw upgrade that moves the string cannot silently reintroduce the CDN.
 */
// Lazy match: the ${...} expression itself contains nested template literals.
export const ESM_SH_FALLBACK = /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/gs;
export const LOCAL_FALLBACK_EXPR = '(typeof document<"u"?new URL("./",document.baseURI).href:"pdfmarkup://app/")';

function neutralizeExcalidrawCdnFallback(): Plugin {
  let replacements = 0;
  return {
    name: "pdf-markup:neutralize-excalidraw-cdn-fallback",
    apply: "build",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw") || !code.includes("https://esm.sh/")) return null;
      const matches = code.match(ESM_SH_FALLBACK)?.length ?? 0;
      replacements += matches;
      return { code: code.replace(ESM_SH_FALLBACK, LOCAL_FALLBACK_EXPR), map: null };
    },
    buildEnd(error) {
      if (error) return; // let the original build error surface
      if (replacements !== 1) {
        this.error(`Expected exactly 1 Excalidraw esm.sh fallback to rewrite, found ${replacements}`);
      }
    },
  };
}

/** Copies Excalidraw fonts and PDF.js cmaps/standard fonts/wasm/ICC profiles into the bundle (no CDN). */
function copyLocalAssets(): Plugin {
  return {
    name: "pdf-markup:copy-local-assets",
    apply: "build",
    closeBundle() {
      const out = resolve(here, "dist");
      const copies: Array<[string, string]> = [
        [resolve(excalidrawDist, "fonts"), resolve(out, "fonts")],
        [resolve(pdfjsRoot, "cmaps"), resolve(out, "pdfjs/cmaps")],
        [resolve(pdfjsRoot, "standard_fonts"), resolve(out, "pdfjs/standard_fonts")],
        [resolve(pdfjsRoot, "wasm"), resolve(out, "pdfjs/wasm")],
        [resolve(pdfjsRoot, "iccs"), resolve(out, "pdfjs/iccs")],
      ];
      for (const [from, to] of copies) {
        if (!existsSync(from)) throw new Error(`Missing local asset directory: ${from}`);
        cpSync(from, to, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), neutralizeExcalidrawCdnFallback(), copyLocalAssets()],
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari17",
    sourcemap: false,
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    restoreMocks: true,
  },
});
