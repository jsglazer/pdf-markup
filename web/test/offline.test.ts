import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FingerPan, routePointer, routeWheel } from "../src/components/inputRouting";
import { configureExcalidrawAssetPath, localAssetBase } from "../src/platform/assetPath";
import { applyVendorPatches, DEFAULT_TEXT_SIZE, VENDOR_PATCHES } from "../build/vendorPatches";

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

  it("every Excalidraw build patch matches the installed vendor bundle exactly as expected", () => {
    const dir = resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod");
    const totals = new Map<string, number>();
    let patched = "";
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      const { code, counts } = applyVendorPatches(readFileSync(resolve(dir, f), "utf8"));
      for (const [name, n] of counts) totals.set(name, (totals.get(name) ?? 0) + n);
      patched += code;
    }
    for (const p of VENDOR_PATCHES) expect(totals.get(p.name), p.name).toBe(p.expected);
    expect(patched).not.toContain("esm.sh");
    expect(patched).toMatch(/size:[\w$]+\.strokeWidth\*2\.125/); // pencil at half width
    for (const v of [7.84, 9.8, 13.72, 17.64]) expect(patched).toContain(`{value:${v},text:`);
    expect(DEFAULT_TEXT_SIZE).toBe(9.8);
  });

  it("no source file in src/ references an http(s) URL (other than the SVG namespace)", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(resolve(dir, d.name)) : [resolve(dir, d.name)],
      );
    for (const file of walk(resolve(root, "src"))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org\/2000\/svg)/); // the SVG XML namespace is an identifier, never fetched
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
