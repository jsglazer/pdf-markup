import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeDecodeError, decodeNativeMessage, decodeWebMessage } from "../src/bridge/protocol";
import { createMemoryTransportPair } from "../src/bridge/transport";
import { DocumentController } from "../src/controller/documentController";
import { element, FakeScheduler, fakePdfSource, hundredPageSizes } from "./fixtures/fakes";

// Shared with the Swift tests (Tests/PDFMarkupCoreTests/BridgeMessageTests.swift).
const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, "../../Tests/PDFMarkupCoreTests/Fixtures/bridge-fixtures.json"), "utf8"),
) as { nativeToWeb: unknown[]; webToNative: unknown[]; invalidNativeToWeb: unknown[] };

describe("BridgeProtocol schema (shared fixtures with Swift)", () => {
  it("decodes every native→web fixture and preserves its fields", () => {
    for (const f of fixtures.nativeToWeb) expect(decodeNativeMessage(JSON.stringify(f))).toEqual(f);
  });

  it("decodes every web→native fixture", () => {
    for (const f of fixtures.webToNative) expect(decodeWebMessage(f)).toEqual(f);
  });

  it("rejects malformed native messages", () => {
    for (const f of fixtures.invalidNativeToWeb) expect(() => decodeNativeMessage(f)).toThrow(BridgeDecodeError);
    expect(() => decodeNativeMessage("{oops")).toThrow(BridgeDecodeError);
  });
});

function boot(sidecarJSON: string | null = null) {
  const pair = createMemoryTransportPair();
  const scheduler = new FakeScheduler();
  const source = fakePdfSource(hundredPageSizes());
  const controller = new DocumentController({
    transport: pair.web,
    openPdf: async () => source,
    rasterize: async () => null,
    scheduler,
  });
  controller.start();
  // Auto-acknowledge saves like the Swift shell does after a coordinated write.
  pair.native.onSend((m) => {
    if (m.type === "saveScene") {
      queueMicrotask(() =>
        pair.native.deliver({ type: "saveResult", requestId: m.requestId, ok: true, storageMode: "sibling", error: null }),
      );
    }
  });
  pair.native.deliver({
    type: "openDocument",
    pdfURL: "pdfmarkup://app/__document__/t.pdf",
    fileName: "deck.pdf",
    sha256: "abc",
    sidecarJSON,
    platform: "ios",
    storageMode: "sibling",
  });
  return { pair, controller, scheduler };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("DocumentController over an in-memory transport (no WKWebView)", () => {
  it("sends ready, opens the document and starts in reading mode with no live page", async () => {
    const { pair, controller } = boot();
    await settle();
    expect(pair.native.sent[0]).toEqual({ type: "ready", protocolVersion: 1 });
    const s = controller.getState();
    expect(s.phase).toBe("ready");
    expect(s.pageSizes).toHaveLength(100);
    expect(s.mode).toBe("reading");
    expect(s.activePage).toBeNull();
  });

  it("flushes the leaving page on page switch and reports dirty state to native", async () => {
    const { pair, controller } = boot();
    await settle();
    controller.setMode("markup", 1);
    controller.updatePage(1, [element("a")]);
    controller.activatePage(2);
    await settle();
    const types = pair.native.sent.map((m) => m.type);
    expect(types).toContain("saveScene");
    expect(pair.native.sent.filter((m) => m.type === "dirtyChanged")).toEqual([
      { type: "dirtyChanged", dirty: true },
      { type: "dirtyChanged", dirty: false },
    ]);
    expect(controller.getState().activePage).toBe(2);
  });

  it("answers a native flushRequest (backgrounding) with flushComplete after saving", async () => {
    const { pair, controller } = boot();
    await settle();
    controller.setMode("markup", 1);
    controller.updatePage(1, [element("a")]);
    pair.native.deliver({ type: "flushRequest", requestId: "f1", reason: "background" });
    await settle();
    await settle();
    const save = pair.native.sent.find((m) => m.type === "saveScene");
    const done = pair.native.sent.find((m) => m.type === "flushComplete");
    expect(save).toBeDefined();
    expect(done).toEqual({ type: "flushComplete", requestId: "f1", saved: true });
    expect(pair.native.sent.indexOf(save!)).toBeLessThan(pair.native.sent.indexOf(done!));
  });

  it("exiting markup mode flushes and unmounts the live page", async () => {
    const { pair, controller } = boot();
    await settle();
    controller.setMode("markup", 4);
    controller.updatePage(4, [element("z")]);
    controller.setMode("reading", null);
    await settle();
    expect(controller.getState().activePage).toBeNull();
    expect(pair.native.sent.some((m) => m.type === "saveScene")).toBe(true);
  });

  it("reloadScene replaces the scene and bumps the epoch so the live instance remounts", async () => {
    const { pair, controller } = boot();
    await settle();
    const epoch = controller.getState().sceneEpoch;
    pair.native.deliver({
      type: "reloadScene",
      sidecarJSON: JSON.stringify({ schemaVersion: 1, pages: { "7": { elements: [element("remote")] } } }),
    });
    expect(controller.elements(7).map((e) => e.id)).toEqual(["remote"]);
    expect(controller.getState().sceneEpoch).toBe(epoch + 1);
  });

  it("logs recovery warnings for a malformed sidecar and still opens", async () => {
    const { pair, controller } = boot("{broken");
    await settle();
    expect(controller.getState().phase).toBe("ready");
    expect(pair.native.sent.some((m) => m.type === "log" && m.level === "warn")).toBe(true);
  });
});
