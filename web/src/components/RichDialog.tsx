import { useEffect, useMemo, useRef, useState } from "react";
import type { RichKind } from "../controller/documentController";
import { DEFAULT_EQUATION_COLOR, EquationError, type EquationRenderer } from "../equations/equation";

interface Props {
  kind: RichKind;
  renderer: EquationRenderer;
  initialSource: string;
  editing: boolean;
  /** Font size used for the Markdown preview (the editor's current text size). */
  previewFontSize: number;
  onSubmit: (source: string) => void;
  onCancel: () => void;
}

const COPY: Record<RichKind, { insert: string; edit: string; placeholder: string; hint: string }> = {
  equation: {
    insert: "Insert equation",
    edit: "Edit equation",
    placeholder: "e = {mc}^2 + \\dfrac{1}{5}",
    hint: "LaTeX, with or without $…$",
  },
  markdown: {
    insert: "Insert text",
    edit: "Edit text",
    placeholder: "# Heading\n**bold**, *italic*, `code`, $x^2$\n- bullet\n1. numbered",
    hint: "Markdown: # headings, **bold**, *italic*, `code`, $math$, - lists. Line breaks are kept.",
  },
};

/** Source entry with a live MathJax preview, for LaTeX equations and Markdown notes. */
export function RichDialog({ kind, renderer, initialSource, editing, previewFontSize, onSubmit, onCancel }: Props) {
  const [source, setSource] = useState(initialSource);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const copy = COPY[kind];

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const preview = useMemo((): { svg: string } | { error: string } | null => {
    if (source.trim() === "") return null;
    try {
      const r =
        kind === "equation"
          ? renderer.render(source)
          : renderer.renderMarkdown(source, DEFAULT_EQUATION_COLOR, Math.max(previewFontSize, 12));
      return { svg: r.svg };
    } catch (e) {
      return { error: e instanceof EquationError ? e.message : String(e) };
    }
  }, [source, renderer, kind, previewFontSize]);

  const valid = preview !== null && "svg" in preview;
  const submit = () => {
    if (valid) onSubmit(source);
  };

  return (
    <div className="eq-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`eq-dialog kind-${kind}`} role="dialog" aria-modal="true" aria-label={editing ? copy.edit : copy.insert}>
        <div className="eq-title">{editing ? copy.edit : copy.insert}</div>
        <textarea
          ref={inputRef}
          className="eq-input"
          value={source}
          spellCheck={kind === "markdown"}
          autoCapitalize="off"
          autoCorrect="off"
          rows={kind === "markdown" ? 7 : 3}
          placeholder={copy.placeholder}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="eq-preview" aria-live="polite">
          {preview === null && <span className="eq-hint">{copy.hint}</span>}
          {preview && "svg" in preview && <div className="eq-svg" dangerouslySetInnerHTML={{ __html: preview.svg }} />}
          {preview && "error" in preview && <span className="eq-error">{preview.error}</span>}
        </div>
        <div className="eq-actions">
          <span className="eq-hint">⌘↩ to {editing ? "update" : "insert"}</span>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!valid} onClick={submit}>
            {editing ? "Update" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
