import { useEffect, useState } from "react";
import type { StaticPreview } from "../excalidraw/adapter";
import type { SidecarElement } from "../sidecar/schema";
import type { PreviewCache } from "./previewCache";

interface Props {
  page: number;
  revision: number;
  elements: readonly SidecarElement[];
  zoom: number;
  cache: PreviewCache;
}

/** Read-only SVG preview of a non-live page's markup, positioned in page points × zoom (D5). */
export function StaticOverlay({ page, revision, elements, zoom, cache }: Props) {
  const [preview, setPreview] = useState<StaticPreview | null>(null);

  useEffect(() => {
    let alive = true;
    void cache.get(page, revision, elements).then((p) => {
      if (alive) setPreview(p);
    });
    return () => {
      alive = false;
    };
  }, [cache, page, revision, elements]);

  if (!preview) return null;
  return (
    <div
      className="markup-static"
      data-static-page={page}
      style={{
        left: preview.rect.x * zoom,
        top: preview.rect.y * zoom,
        width: preview.rect.width * zoom,
        height: preview.rect.height * zoom,
      }}
      // The SVG comes from Excalidraw's exportToSvg over our own sanitized scene; images/embeds are stripped (D7).
      dangerouslySetInnerHTML={{ __html: preview.svg }}
    />
  );
}
