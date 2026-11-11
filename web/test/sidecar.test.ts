import { describe, expect, it } from "vitest";
import { SAVE_DEBOUNCE_MS, SceneStore } from "../src/sidecar/sceneStore";
import { parseSidecar, serializeSidecar, type SidecarV1 } from "../src/sidecar/schema";
import { element, FakeScheduler } from "./fixtures/fakes";

const PDF = { fileName: "deck.pdf", pageCount: 12, sha256: "c0ffee" };

function multiPage(): SidecarV1 {
  return {
    schemaVersion: 1,
    pdf: PDF,
    pages: new Map([
      [1, [element("a", { version: 3, versionNonce: 11 }), element("b", { type: "arrow", version: 7, versionNonce: 22 })]],
      [4, []], // empty page → omitted
      [10, [element("c", { type: "text", text: "Note", version: 2, versionNonce: 33 })]],
      [2, [element("dead", { isDeleted: true })]], // only deleted → omitted
    ]),
  };
}

describe("sidecar serialization round-trip (D6)", () => {
  it("round-trips a multi-page scene: numeric page order, empty pages omitted, versions kept", () => {
    const text = serializeSidecar(multiPage());
    const raw = JSON.parse(text);
    expect(raw.schemaVersion).toBe(1);
    expect(raw.pdf).toEqual(PDF);
    expect(Object.keys(raw.pages)).toEqual(["1", "10"]);
    expect(raw.appState).toBeUndefined();
    expect(raw.files).toBeUndefined();
    for (const page of Object.values(raw.pages) as Array<{ elements: Array<Record<string, unknown>> }>) {
      for (const el of page.elements) {
        expect(typeof el.version).toBe("number");
        expect(typeof el.versionNonce).toBe("number");
      }
    }

    const parsed = parseSidecar(text, PDF);
    expect(parsed.status).toBe("ok");
    expect(parsed.readOnly).toBe(false);
    expect([...parsed.sidecar.pages.keys()]).toEqual([1, 10]);
    expect(parsed.sidecar.pages.get(1)?.map((e) => [e.id, e.version, e.versionNonce])).toEqual([
      ["a", 3, 11],
      ["b", 7, 22],
    ]);
    expect(serializeSidecar(parsed.sidecar)).toBe(text); // byte-stable
  });

  it("strips isDeleted elements on save", () => {
    const s = multiPage();
    s.pages.set(1, [...(s.pages.get(1) ?? []), element("gone", { isDeleted: true })]);
    const raw = JSON.parse(serializeSidecar(s));
    expect(raw.pages["1"].elements.map((e: { id: string }) => e.id)).toEqual(["a", "b"]);
    expect(raw.pages["2"]).toBeUndefined();
  });

  it("an all-empty scene serializes with an empty pages object and parses back", () => {
    const empty: SidecarV1 = { schemaVersion: 1, pdf: PDF, pages: new Map([[3, []]]) };
    const text = serializeSidecar(empty);
    expect(JSON.parse(text).pages).toEqual({});
    const parsed = parseSidecar(text, PDF);
    expect(parsed.status).toBe("ok");
    expect(parsed.sidecar.pages.size).toBe(0);
  });

  it("treats a missing or blank sidecar as an empty scene", () => {
    expect(parseSidecar(null, PDF).status).toBe("empty");
    expect(parseSidecar("  \n", PDF).status).toBe("empty");
  });
});

describe("sidecar error recovery", () => {
  it("recovers from malformed JSON with an empty scene and a warning (never throws)", () => {
    for (const bad of ["{", "not json", '{"schemaVersion":1,"pages":{"1":{"elements":[}}}']) {
      const r = parseSidecar(bad, PDF);
      expect(r.status).toBe("recovered");
      expect(r.sidecar.pages.size).toBe(0);
      expect(r.warnings[0]).toMatch(/not valid JSON/);
      expect(r.readOnly).toBe(false);
    }
  });

  it("recovers from wrong root shapes", () => {
    expect(parseSidecar("[]", PDF).status).toBe("recovered");
    expect(parseSidecar('{"pages":{}}', PDF).warnings[0]).toMatch(/schemaVersion/);
    expect(parseSidecar('{"schemaVersion":1,"pages":[]}', PDF).warnings[0]).toMatch(/no pages object/);
  });

  it("salvages valid pages and elements and drops only the broken ones", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      pages: {
        "1": { elements: [element("ok1"), { id: "noversion", type: "line" }, "junk", element("img", { type: "image" })] },
        "0": { elements: [element("zero")] },
        abc: { elements: [element("x")] },
        "3": { notElements: true },
        "5": { elements: [element("ok5")] },
      },
    });
    const r = parseSidecar(text, PDF);
    expect(r.status).toBe("recovered");
    expect(r.sidecar.pages.get(1)?.map((e) => e.id)).toEqual(["ok1"]);
    expect(r.sidecar.pages.get(5)?.map((e) => e.id)).toEqual(["ok5"]);
    expect(r.sidecar.pages.has(3)).toBe(false);
    expect(r.warnings).toHaveLength(6);
  });

  it("opens a newer schemaVersion read-only and refuses to save over it", async () => {
    const text = JSON.stringify({ schemaVersion: 2, pages: { "1": { elements: [element("future")] } } });
    const r = parseSidecar(text, PDF);
    expect(r.readOnly).toBe(true);
    expect(r.sidecar.pages.get(1)?.[0]?.id).toBe("future");
    const saves: string[] = [];
    const store = new SceneStore(r.sidecar, PDF, async (t) => (saves.push(t), true), new FakeScheduler(), r.readOnly);
    expect(store.updatePage(1, [element("mine")])).toBe(false);
    expect(await store.flush("close")).toBe(false);
    expect(saves).toHaveLength(0);
  });
});

describe("SceneStore save cadence (D8)", () => {
  function makeStore(ok = true) {
    const scheduler = new FakeScheduler();
    const saves: Array<{ text: string; trigger: string }> = [];
    const dirtyEvents: boolean[] = [];
    let result = ok;
    const store = new SceneStore(null, PDF, async (text, trigger) => {
      saves.push({ text, trigger });
      return result;
    }, scheduler);
    store.onDirtyChange((d) => dirtyEvents.push(d));
    return { store, scheduler, saves, dirtyEvents, setResult: (v: boolean) => (result = v) };
  }

  it("debounces onChange by 750 ms and saves once", async () => {
    const { store, scheduler, saves } = makeStore();
    store.updatePage(1, [element("a", { version: 1, versionNonce: 1 })]);
    scheduler.advance(SAVE_DEBOUNCE_MS - 1);
    store.updatePage(1, [element("a", { version: 2, versionNonce: 2 })]);
    scheduler.advance(SAVE_DEBOUNCE_MS - 1);
    expect(saves).toHaveLength(0);
    scheduler.advance(1);
    await Promise.resolve();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.trigger).toBe("debounce");
    expect(JSON.parse(saves[0]?.text ?? "").pages["1"].elements[0].version).toBe(2);
  });

  it("ignores onChange calls that change no element version (selection, pointer moves)", () => {
    const { store, scheduler } = makeStore();
    const els = [element("a", { version: 1, versionNonce: 5 })];
    expect(store.updatePage(1, els)).toBe(true);
    expect(store.updatePage(1, els.map((e) => ({ ...e })))).toBe(false);
    expect(scheduler.pending).toBe(1);
  });

  it("flushes immediately on page switch / background / close and cancels the pending debounce", async () => {
    for (const trigger of ["pageSwitch", "modeExit", "background", "close"] as const) {
      const { store, scheduler, saves } = makeStore();
      store.updatePage(2, [element("p2")]);
      expect(await store.flush(trigger)).toBe(true);
      expect(saves.map((s) => s.trigger)).toEqual([trigger]);
      expect(scheduler.pending).toBe(0);
      expect(store.hasDirtyPages).toBe(false);
      expect(await store.flush(trigger)).toBe(false); // nothing dirty → no write
    }
  });

  it("re-marks pages dirty when the native write fails", async () => {
    const { store, saves, dirtyEvents, setResult } = makeStore(false);
    store.updatePage(3, [element("x")]);
    expect(await store.flush("background")).toBe(false);
    expect(store.dirtyPages()).toEqual([3]);
    setResult(true);
    expect(await store.flush("background")).toBe(true);
    expect(saves).toHaveLength(2);
    expect(dirtyEvents.at(-1)).toBe(false);
  });

  it("keeps a page dirty when it is edited while its save is in flight", async () => {
    const scheduler = new FakeScheduler();
    let release: (v: boolean) => void = () => undefined;
    const store = new SceneStore(null, PDF, () => new Promise<boolean>((r) => (release = r)), scheduler);
    store.updatePage(1, [element("a", { version: 1, versionNonce: 1 })]);
    const pending = store.flush("manual");
    store.updatePage(1, [element("a", { version: 2, versionNonce: 2 })]);
    release(true);
    await pending;
    expect(store.dirtyPages()).toEqual([1]);
  });

  it("emptying a page removes it from the sidecar", async () => {
    const { store, saves } = makeStore();
    store.updatePage(1, [element("a")]);
    await store.flush("manual");
    store.updatePage(1, [element("a", { isDeleted: true, version: 9, versionNonce: 9 })]);
    await store.flush("manual");
    expect(JSON.parse(saves.at(-1)?.text ?? "").pages).toEqual({});
  });
});
