/// <reference types="vitest/config" />
import { cpSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { applyVendorPatches, VENDOR_PATCHES } from "./build/vendorPatches";

const here = dirname(fileURLToPath(import.meta.url));
const excalidrawDist = resolve(here, "node_modules/@excalidraw/excalidraw/dist/prod");
const pdfjsRoot = resolve(here, "node_modules/pdfjs-dist");

/**
 * Applies the guarded Excalidraw patches in build/vendorPatches.ts (CDN fallback → local origin,
 * thinner pencil strokes, smaller text sizes). Fails the build unless each matches exactly as expected.
 */
function patchExcalidraw(): Plugin {
  const totals = new Map<string, number>();
  return {
    name: "pdf-markup:patch-excalidraw",
    apply: "build",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/prod")) return null;
      const { code: out, counts } = applyVendorPatches(code);
      for (const [name, n] of counts) totals.set(name, (totals.get(name) ?? 0) + n);
      return out === code ? null : { code: out, map: null };
    },
    buildEnd(error) {
      if (error) return; // let the original build error surface
      for (const p of VENDOR_PATCHES) {
        const n = totals.get(p.name) ?? 0;
        if (n !== p.expected) this.error(`Excalidraw patch "${p.name}": expected ${p.expected} match(es), found ${n}`);
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
  plugins: [react(), patchExcalidraw(), copyLocalAssets()],
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
