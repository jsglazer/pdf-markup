import type { Size } from "../../src/geometry/coords";
import type { PdfDocumentSource } from "../../src/pdf/pdfSource";
import type { Scheduler } from "../../src/sidecar/sceneStore";
import type { SidecarElement } from "../../src/sidecar/schema";

/** 100-page fixture: alternating 16:9 and 4:3 slides with a letter page every 10th page. */
export function hundredPageSizes(): Size[] {
  return Array.from({ length: 100 }, (_, i) =>
    (i + 1) % 10 === 0 ? { width: 612, height: 792 } : i % 2 === 0 ? { width: 960, height: 540 } : { width: 720, height: 540 },
  );
}

export function fakePdfSource(pageSizes: Size[], data = new Uint8Array([37, 80, 68, 70])): PdfDocumentSource & {
  rendered: number[];
  cancelled: number[];
} {
  const rendered: number[] = [];
  const cancelled: number[] = [];
  return {
    pageSizes,
    rendered,
    cancelled,
    getPage: async (n) => ({
      render: () => {
        rendered.push(n);
        return { promise: Promise.resolve(), cancel: () => cancelled.push(n) };
      },
    }),
    getData: async () => data,
    destroy: () => undefined,
  };
}

/** Deterministic scheduler: timers fire only when the test calls advance(). */
export class FakeScheduler implements Scheduler {
  private now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, t] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= this.now) {
        this.timers.delete(id);
        t.fn();
      }
    }
  }
}

let seq = 0;
export function element(id: string, overrides: Partial<SidecarElement> = {}): SidecarElement {
  seq += 1;
  return {
    id,
    type: "rectangle",
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    angle: 0,
    version: 1,
    versionNonce: 1000 + seq,
    isDeleted: false,
    ...overrides,
  };
}
