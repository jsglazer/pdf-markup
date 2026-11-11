import {
  emptySidecar,
  sanitizeElements,
  serializeSidecar,
  type SidecarElement,
  type SidecarPdfInfo,
  type SidecarV1,
} from "./schema";

/** Injected timer so the store has no hidden dependence on wall-clock time (fake in tests). */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** D8: onChange is debounced 750 ms before a save is sent over the bridge. */
export const SAVE_DEBOUNCE_MS = 750;

export type FlushTrigger = "debounce" | "pageSwitch" | "modeExit" | "background" | "close" | "conflict" | "manual";

/** Persists serialized sidecar text. Resolves true when the coordinated native write succeeded. */
export type PersistFn = (sidecarJSON: string, trigger: FlushTrigger) => Promise<boolean>;

/**
 * Holds every page's scene, tracks dirty pages, and saves on the D8 cadence. One store per open document.
 * Per-page revisions let the static-preview cache regenerate only pages whose scene changed (D5).
 */
export class SceneStore {
  private sidecar: SidecarV1;
  private readonly revisions = new Map<number, number>();
  private readonly fingerprints = new Map<number, string>();
  private readonly dirty = new Set<number>();
  private timer: unknown = null;
  private inFlight: Promise<boolean> | null = null;
  private readonly listeners = new Set<(dirty: boolean) => void>();

  constructor(
    initial: SidecarV1 | null,
    pdf: SidecarPdfInfo,
    private readonly persist: PersistFn,
    private readonly scheduler: Scheduler,
    private readOnlyFlag = false,
  ) {
    this.sidecar = initial ?? emptySidecar(pdf);
    this.sidecar.pdf = { ...pdf };
    for (const [page, elements] of this.sidecar.pages) this.fingerprints.set(page, fingerprint(elements));
  }

  get readOnly(): boolean {
    return this.readOnlyFlag;
  }

  get hasDirtyPages(): boolean {
    return this.dirty.size > 0;
  }

  dirtyPages(): number[] {
    return [...this.dirty].sort((a, b) => a - b);
  }

  elements(page: number): readonly SidecarElement[] {
    return this.sidecar.pages.get(page) ?? [];
  }

  revision(page: number): number {
    return this.revisions.get(page) ?? 0;
  }

  onDirtyChange(fn: (dirty: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Called from the live Excalidraw onChange. Ignores calls that do not change any element version
   * (selection, hover, pointer moves), so the debounce only restarts for real edits.
   */
  updatePage(page: number, rawElements: readonly unknown[]): boolean {
    if (this.readOnlyFlag) return false;
    const elements = sanitizeElements(rawElements);
    const fp = fingerprint(elements);
    if (fp === (this.fingerprints.get(page) ?? "")) return false;
    this.fingerprints.set(page, fp);
    if (elements.length === 0) this.sidecar.pages.delete(page);
    else this.sidecar.pages.set(page, elements.map((e) => ({ ...e })));
    this.revisions.set(page, this.revision(page) + 1);
    this.markDirty(page);
    this.scheduleSave();
    return true;
  }

  /** Replaces the whole scene (foreground reload when there are no dirty pages — D8). */
  replaceAll(next: SidecarV1, readOnly: boolean): void {
    this.cancelTimer();
    const pages = new Set([...this.sidecar.pages.keys(), ...next.pages.keys()]);
    this.sidecar = { ...next, pdf: this.sidecar.pdf };
    this.readOnlyFlag = readOnly;
    this.fingerprints.clear();
    for (const page of pages) {
      const els = next.pages.get(page) ?? [];
      this.fingerprints.set(page, fingerprint(els));
      this.revisions.set(page, this.revision(page) + 1);
    }
    this.setClean([...this.dirty]);
  }

  /** Serialized form of the current scene (deterministic). */
  serialize(): string {
    return serializeSidecar(this.sidecar);
  }

  /**
   * Saves immediately if anything is dirty. Used for page switch, markup-mode exit, backgrounding and
   * close (D8). Waits for an in-flight save first so writes are never reordered.
   */
  async flush(trigger: FlushTrigger): Promise<boolean> {
    this.cancelTimer();
    if (this.inFlight) await this.inFlight;
    if (this.readOnlyFlag || this.dirty.size === 0) return false;
    const snapshot = new Map([...this.dirty].map((p) => [p, this.revision(p)]));
    const text = this.serialize();
    // Clear optimistically; pages edited while the write is in flight have a newer revision and stay dirty.
    this.setClean([...snapshot.keys()]);
    const run = this.persist(text, trigger).catch(() => false);
    this.inFlight = run;
    const ok = await run;
    this.inFlight = null;
    if (!ok) {
      for (const page of snapshot.keys()) this.markDirty(page);
      return false;
    }
    for (const [page, rev] of snapshot) if (this.revision(page) !== rev) this.markDirty(page);
    return true;
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }

  private scheduleSave(): void {
    this.cancelTimer();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.flush("debounce");
    }, SAVE_DEBOUNCE_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private markDirty(page: number): void {
    const was = this.dirty.size > 0;
    this.dirty.add(page);
    if (!was) this.emit(true);
  }

  private setClean(pages: number[]): void {
    const was = this.dirty.size > 0;
    for (const p of pages) this.dirty.delete(p);
    if (was && this.dirty.size === 0) this.emit(false);
  }

  private emit(dirty: boolean): void {
    for (const fn of this.listeners) fn(dirty);
  }
}

/** Identity of a page's content: element ids with their versions, order-sensitive. */
export function fingerprint(elements: readonly SidecarElement[]): string {
  return elements.map((e) => `${e.id}:${e.version}:${e.versionNonce}`).join("|");
}
