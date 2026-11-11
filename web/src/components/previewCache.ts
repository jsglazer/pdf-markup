import type { SidecarElement } from "../sidecar/schema";
import type { StaticPreview } from "../excalidraw/adapter";

export type PreviewRenderer = (elements: readonly SidecarElement[]) => Promise<StaticPreview | null>;

/**
 * Per-document cache of static page previews keyed by the page's scene revision (D5): a preview is
 * regenerated only when that page's scene changed. Owned by one document view — no module-level state.
 */
export class PreviewCache {
  private readonly entries = new Map<number, { revision: number; result: Promise<StaticPreview | null> }>();
  renders = 0;

  constructor(private readonly render: PreviewRenderer) {}

  get(page: number, revision: number, elements: readonly SidecarElement[]): Promise<StaticPreview | null> {
    const hit = this.entries.get(page);
    if (hit && hit.revision === revision) return hit.result;
    this.renders += 1;
    const result = elements.length === 0 ? Promise.resolve(null) : this.render(elements).catch(() => null);
    this.entries.set(page, { revision, result });
    return result;
  }

  clear(): void {
    this.entries.clear();
  }
}
