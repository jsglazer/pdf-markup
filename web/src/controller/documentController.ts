import { BRIDGE_PROTOCOL_VERSION, type NativeToWebMessage, type Platform, type StorageMode } from "../bridge/protocol";
import type { BridgeTransport } from "../bridge/transport";
import { bytesToBase64, flattenPdf, markedFileName, type RasterizePage } from "../export/flatten";
import type { Size } from "../geometry/coords";
import type { OpenPdf, PdfDocumentSource } from "../pdf/pdfSource";
import { parseSidecar, type SidecarElement, type SidecarPdfInfo } from "../sidecar/schema";
import { SceneStore, type FlushTrigger, type Scheduler } from "../sidecar/sceneStore";

/** Kinds of source-backed elements the dialogs create: LaTeX equations and Markdown notes. */
export type RichKind = "equation" | "markdown";

/** What the single live editor exposes for equations / Markdown notes (implemented by the Excalidraw adapter). */
export interface LiveEditorHandle {
  insertRich(kind: RichKind, source: string): void;
  updateRich(id: string, source: string): void;
}

export interface SelectedRich {
  id: string;
  kind: RichKind;
  source: string;
}

export type Mode = "reading" | "markup";

export interface ControllerState {
  phase: "waiting" | "loading" | "ready" | "error";
  error: string | null;
  fileName: string;
  platform: Platform;
  storageMode: StorageMode;
  readOnly: boolean;
  mode: Mode;
  /** Page that hosts the single live Excalidraw instance in markup mode. */
  activePage: number | null;
  pageSizes: readonly Size[];
  warnings: string[];
  exporting: boolean;
  /** Bumped when the scene is replaced from disk, so the live instance remounts with fresh data. */
  sceneEpoch: number;
  /** The single selected element in the live editor, when it is an equation or Markdown note. */
  selectedRich: SelectedRich | null;
  /** True while a live editor is mounted and can take a new equation / note. */
  canInsertRich: boolean;
  /** Incremented when the user double-clicks (or presses Enter on) the selected equation / note. */
  richEditRequest: number;
}

export interface ControllerDeps {
  transport: BridgeTransport;
  openPdf: OpenPdf;
  rasterize: RasterizePage;
  scheduler: Scheduler;
}

const INITIAL: ControllerState = {
  phase: "waiting",
  error: null,
  fileName: "",
  platform: "browser",
  storageMode: "sibling",
  readOnly: false,
  mode: "reading",
  activePage: null,
  pageSizes: [],
  warnings: [],
  exporting: false,
  sceneEpoch: 0,
  selectedRich: null,
  canInsertRich: false,
  richEditRequest: 0,
};

/**
 * Orchestrates one open document: bridge messages, the SceneStore, the active page and export.
 * Framework-free; React subscribes through subscribe()/getState() (useSyncExternalStore).
 */
export class DocumentController {
  private state: ControllerState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private store: SceneStore | null = null;
  private source: PdfDocumentSource | null = null;
  private pdfInfo: SidecarPdfInfo | null = null;
  private nextRequest = 1;
  private readonly pendingSaves = new Map<string, (ok: boolean) => void>();
  private unsubscribe: (() => void) | null = null;
  private liveEditor: LiveEditorHandle | null = null;

  constructor(private readonly deps: ControllerDeps) {}

  // ---- external store -----------------------------------------------------------------------------

  getState = (): ControllerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<ControllerState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ---- lifecycle ----------------------------------------------------------------------------------

  start(): void {
    this.unsubscribe = this.deps.transport.onMessage((m) => void this.handle(m));
    this.deps.transport.send({ type: "ready", protocolVersion: BRIDGE_PROTOCOL_VERSION });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.store?.dispose();
    this.source?.destroy();
  }

  get pdfSource(): PdfDocumentSource | null {
    return this.source;
  }

  elements(page: number): readonly SidecarElement[] {
    return this.store?.elements(page) ?? [];
  }

  revision(page: number): number {
    return this.store?.revision(page) ?? 0;
  }

  get hasDirtyPages(): boolean {
    return this.store?.hasDirtyPages ?? false;
  }

  /** Live Excalidraw onChange → store (debounced save inside the store). */
  updatePage = (page: number, elements: readonly unknown[]): void => {
    if (this.store?.updatePage(page, elements)) this.set({});
  };

  // ---- equations & Markdown notes ---------------------------------------------------------------

  /** Registered by the live editor on mount (null on unmount). */
  setLiveEditor = (handle: LiveEditorHandle | null): void => {
    this.liveEditor = handle;
    if (this.state.canInsertRich !== (handle !== null)) this.set({ canInsertRich: handle !== null });
  };

  setSelectedRich = (selection: SelectedRich | null): void => {
    const cur = this.state.selectedRich;
    if (cur?.id === selection?.id && cur?.source === selection?.source && cur?.kind === selection?.kind) return;
    this.set({ selectedRich: selection });
  };

  requestRichEdit = (): void => {
    if (this.state.selectedRich) this.set({ richEditRequest: this.state.richEditRequest + 1 });
  };

  /** Inserts a new equation / note, or replaces the source of `editId`. False when no live editor exists. */
  commitRich(kind: RichKind, source: string, editId: string | null): boolean {
    if (!this.liveEditor || this.state.readOnly) return false;
    if (editId) this.liveEditor.updateRich(editId, source);
    else this.liveEditor.insertRich(kind, source);
    return true;
  }

  // ---- modes & active page (D5) -------------------------------------------------------------------

  /** Enter/leave markup mode. Leaving flushes immediately (D8). */
  setMode(mode: Mode, initialActivePage: number | null): void {
    if (mode === this.state.mode) return;
    if (mode === "reading") {
      void this.flush("modeExit");
      this.set({ mode, activePage: null });
    } else {
      this.set({ mode, activePage: initialActivePage });
    }
  }

  /** Moves the single live instance to `page`, flushing the page it leaves first (D5, D8). */
  activatePage(page: number): void {
    if (this.state.mode !== "markup" || page === this.state.activePage) return;
    if (page < 1 || page > this.state.pageSizes.length) return;
    void this.flush("pageSwitch");
    this.set({ activePage: page });
  }

  flush(trigger: FlushTrigger): Promise<boolean> {
    return this.store ? this.store.flush(trigger) : Promise.resolve(false);
  }

  // ---- bridge -------------------------------------------------------------------------------------

  private async handle(message: NativeToWebMessage): Promise<void> {
    switch (message.type) {
      case "openDocument":
        await this.open(message);
        return;
      case "saveResult": {
        const resolve = this.pendingSaves.get(message.requestId);
        this.pendingSaves.delete(message.requestId);
        if (message.storageMode !== this.state.storageMode) this.set({ storageMode: message.storageMode });
        if (!message.ok) this.log("error", `save failed: ${message.error ?? "unknown error"}`);
        resolve?.(message.ok);
        return;
      }
      case "flushRequest": {
        const saved = await this.flush(message.reason);
        this.deps.transport.send({ type: "flushComplete", requestId: message.requestId, saved });
        return;
      }
      case "reloadScene":
        this.reload(message.sidecarJSON);
        return;
      case "requestExport":
        await this.exportFlattened();
        return;
    }
  }

  private async open(m: Extract<NativeToWebMessage, { type: "openDocument" }>): Promise<void> {
    this.store?.dispose();
    this.source?.destroy();
    this.store = null;
    this.source = null;
    this.set({ ...INITIAL, phase: "loading", fileName: m.fileName, platform: m.platform, storageMode: m.storageMode });
    try {
      const source = await this.deps.openPdf(m.pdfURL);
      this.source = source;
      const pdf: SidecarPdfInfo = { fileName: m.fileName, pageCount: source.pageSizes.length, sha256: m.sha256 };
      this.pdfInfo = pdf;
      const parsed = parseSidecar(m.sidecarJSON, pdf);
      for (const w of parsed.warnings) this.log("warn", w);
      const store = new SceneStore(parsed.sidecar, pdf, this.persist, this.deps.scheduler, parsed.readOnly);
      store.onDirtyChange((dirty) => this.deps.transport.send({ type: "dirtyChanged", dirty }));
      this.store = store;
      this.set({
        phase: "ready",
        pageSizes: source.pageSizes,
        readOnly: parsed.readOnly,
        warnings: parsed.warnings,
      });
    } catch (error) {
      this.set({ phase: "error", error: (error as Error).message });
      this.log("error", `could not open PDF: ${(error as Error).message}`);
    }
  }

  private reload(text: string): void {
    if (!this.store || !this.pdfInfo) return;
    const parsed = parseSidecar(text, this.pdfInfo);
    for (const w of parsed.warnings) this.log("warn", w);
    this.store.replaceAll(parsed.sidecar, parsed.readOnly);
    this.set({ readOnly: parsed.readOnly, sceneEpoch: this.state.sceneEpoch + 1 });
  }

  private readonly persist = (sidecarJSON: string): Promise<boolean> => {
    const requestId = `save-${this.nextRequest++}`;
    return new Promise<boolean>((resolve) => {
      this.pendingSaves.set(requestId, resolve);
      this.deps.transport.send({ type: "saveScene", requestId, sidecarJSON });
    });
  };

  // ---- export (D9) --------------------------------------------------------------------------------

  async exportFlattened(): Promise<void> {
    if (!this.source || !this.store || this.state.exporting) return;
    this.set({ exporting: true });
    try {
      await this.flush("manual");
      const original = await this.source.getData();
      const pages = new Map<number, readonly SidecarElement[]>();
      for (let p = 1; p <= this.state.pageSizes.length; p++) {
        const els = this.store.elements(p);
        if (els.length > 0) pages.set(p, els);
      }
      const { bytes } = await flattenPdf(original, pages, this.deps.rasterize);
      this.deps.transport.send({
        type: "exportReady",
        fileName: markedFileName(this.state.fileName),
        pdfBase64: bytesToBase64(bytes),
      });
    } catch (error) {
      this.deps.transport.send({ type: "exportFailed", message: (error as Error).message });
    } finally {
      this.set({ exporting: false });
    }
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.deps.transport.send({ type: "log", level, message });
  }
}
