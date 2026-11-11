import { useEffect, useMemo, useRef, useState } from "react";
import { EquationError, type EquationRenderer } from "../equations/equation";

interface Props {
  renderer: EquationRenderer;
  initialLatex: string;
  editing: boolean;
  onSubmit: (latex: string) => void;
  onCancel: () => void;
}

/** LaTeX entry with a live MathJax preview. $…$ / \(…\) delimiters are accepted and stripped. */
export function EquationDialog({ renderer, initialLatex, editing, onSubmit, onCancel }: Props) {
  const [latex, setLatex] = useState(initialLatex);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const preview = useMemo((): { svg: string } | { error: string } | null => {
    if (latex.trim() === "") return null;
    try {
      return { svg: renderer.render(latex).svg };
    } catch (e) {
      return { error: e instanceof EquationError ? e.message : String(e) };
    }
  }, [latex, renderer]);

  const valid = preview !== null && "svg" in preview;
  const submit = () => {
    if (valid) onSubmit(latex);
  };

  return (
    <div className="eq-backdrop" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="eq-dialog" role="dialog" aria-modal="true" aria-label={editing ? "Edit equation" : "Insert equation"}>
        <div className="eq-title">{editing ? "Edit equation" : "Insert equation"}</div>
        <textarea
          ref={inputRef}
          className="eq-input"
          value={latex}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={"e = {mc}^2 + \\dfrac{1}{5}"}
          onChange={(e) => setLatex(e.target.value)}
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
          {preview === null && <span className="eq-hint">LaTeX, with or without $…$</span>}
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
