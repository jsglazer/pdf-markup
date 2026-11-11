import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FingerPan, routePointer, routeWheel } from "../src/components/inputRouting";
import { configureExcalidrawAssetPath, localAssetBase } from "../src/platform/assetPath";
import { ESM_SH_FALLBACK, LOCAL_FALLBACK_EXPR } from "../vite.config";

const root = resolve(__dirname, "..");

describe("offline asset configuration", () => {
  it("points EXCALIDRAW_ASSET_PATH at the app's own pdfmarkup:// origin", () => {
    const win = {} as Window & { EXCALIDRAW_ASSET_PATH?: string };
    expect(configureExcalidrawAssetPath(win, "pdfmarkup://app/index.html")).toBe("pdfmarkup://app/");
    expect(win.EXCALIDRAW_ASSET_PATH).toBe("pdfmarkup://app/");
  });

  it("refuses a remote asset base", () => {
    expect(() => localAssetBase("https://cdn.example.com/app/index.html")).toThrow(/non-local/);
    expect(localAssetBase("http://localhost:5173/index.html")).toBe("http://localhost:5173/");
  });

  it("the CSP in index.html allows no http(s) source", () => {
    const html = readFileSync(resolve(root, "index.html"), "utf8");
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/https?:/);
    expect(csp).toContain("frame-src 'none'");
  });

  it("the build rewrites Excalidraw's esm.sh font fallback exactly once in the shipped vendor chunk", () => {
    const dir = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod");
    let matches = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      const code = readFileSync(resolve(dir, f), "utf8");
      const found = code.match(ESM_SH_FALLBACK)?.length ?? 0;
      matches += found;
      if (found) expect(code.replace(ESM_SH_FALLBACK, LOCAL_FALLBACK_EXPR)).not.toContain("esm.sh");
    }
    expect(matches).toBe(1);
  });

  it("no source file in src/ references an http(s) URL", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(resolve(dir, d.name)) : [resolve(dir, d.name)],
      );
    for (const file of walk(resolve(root, "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/);
    }
  });
});

describe("input routing (D3/D4)", () => {
  it("iPad markup: pencil draws, finger pans the document; reading mode is native", () => {
    expect(routePointer("pen", "ios", "markup")).toBe("excalidraw");
    expect(routePointer("touch", "ios", "markup")).toBe("documentPan");
    expect(routePointer("touch", "ios", "reading")).toBe("native");
    expect(routePointer("mouse", "macos", "markup")).toBe("excalidraw");
  });

  it("ctrl+wheel zooms through the controller; plain wheel scrolls the document", () => {
    expect(routeWheel(true)).toBe("zoom");
    expect(routeWheel(false)).toBe("documentScroll");
  });

  it("forwards single-finger pans as scroll deltas and yields to two-finger pinch", () => {
    const pan = new FingerPan();
    pan.start(1, 100, 100);
    expect(pan.move(1, 90, 70)).toEqual({ dx: 10, dy: 30 });
    pan.start(2, 300, 300);
    expect(pan.move(1, 80, 60)).toBeNull();
    pan.end(2);
    pan.end(1);
    expect(pan.activeCount).toBe(0);
  });
});
