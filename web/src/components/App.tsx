import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { DocumentController } from "../controller/documentController";
import type { Scheduler } from "../sidecar/sceneStore";
import { DocumentScroller } from "./DocumentScroller";
import { PreviewCache, type PreviewRenderer } from "./previewCache";
import { Toolbar } from "./Toolbar";
import { RichDialog } from "./RichDialog";
import { DEFAULT_TEXT_SIZE } from "../../build/vendorPatches";
import type { RichKind } from "../controller/documentController";
import type { EquationRenderer } from "../equations/equation";

interface Props {
  controller: DocumentController;
  scheduler: Scheduler;
  renderPreview: PreviewRenderer;
  equations: EquationRenderer;
}

export function App({ controller, scheduler, renderPreview, equations }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomCommand, setZoomCommand] = useState<{ kind: "in" | "out" | "fit"; nonce: number } | null>(null);
  const [richDialog, setRichDialog] = useState<{ kind: RichKind; source: string; editId: string | null } | null>(null);
  const [navigateTo, setNavigateTo] = useState<{ page: number; nonce: number } | null>(null);
  const source = state.phase === "ready" ? controller.pdfSource : null;
  // One preview cache per opened document (keyed by the PDF source instance).
  const previewCache = useMemo(() => new PreviewCache(renderPreview), [renderPreview, source]);

  useEffect(() => {
    setCurrentPage(1);
  }, [source]);

  // Double-click / Enter on a selected equation or note opens it for editing.
  const { richEditRequest, selectedRich } = state;
  useEffect(() => {
    if (richEditRequest > 0 && selectedRich) {
      setRichDialog({ kind: selectedRich.kind, source: selectedRich.source, editId: selectedRich.id });
    }
    // Only a new request opens the dialog, not a selection change.
  }, [richEditRequest]);

  /** Toolbar: edit the selected element of that kind, otherwise start a new one. */
  const openRich = (kind: RichKind) =>
    setRichDialog(
      state.selectedRich?.kind === kind
        ? { kind, source: state.selectedRich.source, editId: state.selectedRich.id }
        : { kind, source: "", editId: null },
    );

  const goTo = useCallback(
    (page: number) => {
      const clamped = Math.min(Math.max(1, Math.round(page)), state.pageSizes.length || 1);
      setNavigateTo((prev) => ({ page: clamped, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [state.pageSizes.length],
  );

  if (state.phase === "waiting") return <div className="status">Waiting for document…</div>;
  if (state.phase === "loading") return <div className="status">Loading {state.fileName}…</div>;
  if (state.phase === "error") return <div className="status error">Could not open this PDF: {state.error}</div>;
  if (!source) return null;

  return (
    <div className="app">
      <Toolbar
        fileName={state.fileName}
        mode={state.mode}
        readOnly={state.readOnly}
        currentPage={currentPage}
        pageCount={state.pageSizes.length}
        exporting={state.exporting}
        onToggleMode={() =>
          controller.setMode(state.mode === "markup" ? "reading" : "markup", state.mode === "markup" ? null : currentPage)
        }
        onGoTo={goTo}
        onZoom={(kind) => setZoomCommand((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }))}
        onExport={() => void controller.exportFlattened()}
        rich={
          state.mode === "markup" && !state.readOnly
            ? { editing: state.selectedRich?.kind ?? null, enabled: state.canInsertRich }
            : null
        }
        onRich={openRich}
      />
      {richDialog && (
        <RichDialog
          kind={richDialog.kind}
          renderer={equations}
          initialSource={richDialog.source}
          editing={richDialog.editId !== null}
          previewFontSize={DEFAULT_TEXT_SIZE}
          onCancel={() => setRichDialog(null)}
          onSubmit={(source) => {
            controller.commitRich(richDialog.kind, source, richDialog.editId);
            setRichDialog(null);
          }}
        />
      )}
      {state.readOnly && (
        <div className="banner">This markup was saved by a newer version of the app and is read-only here.</div>
      )}
      <DocumentScroller
        controller={controller}
        source={source}
        platform={state.platform}
        mode={state.mode}
        activePage={state.activePage}
        readOnly={state.readOnly}
        sceneEpoch={state.sceneEpoch}
        previewCache={previewCache}
        scheduler={scheduler}
        zoomCommand={zoomCommand}
        navigateTo={navigateTo}
        onCurrentPageChange={setCurrentPage}
        equations={equations}
      />
    </div>
  );
}
