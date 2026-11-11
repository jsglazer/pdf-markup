import { useEffect, useState } from "react";
import type { Mode } from "../controller/documentController";

interface Props {
  fileName: string;
  mode: Mode;
  readOnly: boolean;
  currentPage: number;
  pageCount: number;
  exporting: boolean;
  onToggleMode: () => void;
  onGoTo: (page: number) => void;
  onZoom: (kind: "in" | "out" | "fit") => void;
  onExport: () => void;
  /** null = hidden (not in markup mode); otherwise the label state of the ∑ button. */
  equation: { editing: boolean; enabled: boolean } | null;
  onEquation: () => void;
}

export function Toolbar(p: Props) {
  const [pageInput, setPageInput] = useState(String(p.currentPage));
  useEffect(() => setPageInput(String(p.currentPage)), [p.currentPage]);

  return (
    <div className="toolbar" role="toolbar">
      <span className="title" title={p.fileName}>
        {p.fileName}
      </span>
      <button type="button" onClick={() => p.onGoTo(p.currentPage - 1)} disabled={p.currentPage <= 1} aria-label="Previous page">
        ‹
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(pageInput);
          if (Number.isFinite(n)) p.onGoTo(n);
        }}
      >
        <input
          className="page-input"
          inputMode="numeric"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          aria-label="Page number"
        />
        <span className="page-count">/ {p.pageCount}</span>
      </form>
      <select
        className="page-list"
        aria-label="Page list"
        value={p.currentPage}
        onChange={(e) => p.onGoTo(Number(e.target.value))}
      >
        {Array.from({ length: p.pageCount }, (_, i) => (
          <option key={i + 1} value={i + 1}>
            Page {i + 1}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => p.onGoTo(p.currentPage + 1)} disabled={p.currentPage >= p.pageCount} aria-label="Next page">
        ›
      </button>
      <span className="spacer" />
      <button type="button" onClick={() => p.onZoom("out")} aria-label="Zoom out">
        −
      </button>
      <button type="button" onClick={() => p.onZoom("fit")}>Fit width</button>
      <button type="button" onClick={() => p.onZoom("in")} aria-label="Zoom in">
        +
      </button>
      {p.equation && (
        <button
          type="button"
          onClick={p.onEquation}
          disabled={!p.equation.enabled}
          title={p.equation.editing ? "Edit the selected equation" : "Insert a LaTeX equation"}
        >
          {p.equation.editing ? "Edit ∑" : "∑ Equation"}
        </button>
      )}
      <button
        type="button"
        className={p.mode === "markup" ? "active" : ""}
        onClick={p.onToggleMode}
        disabled={p.readOnly}
        aria-pressed={p.mode === "markup"}
      >
        {p.mode === "markup" ? "Done" : "Markup"}
      </button>
      <button type="button" onClick={p.onExport} disabled={p.exporting}>
        {p.exporting ? "Exporting…" : "Export"}
      </button>
    </div>
  );
}
