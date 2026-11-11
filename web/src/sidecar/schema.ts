/**
 * Sidecar schema v1 (D6):
 *   { schemaVersion: 1, pdf: { fileName, pageCount, sha256 }, pages: { "1": { elements: [...] } } }
 * - 1-based string page keys; empty pages omitted.
 * - Coordinates are PDF points at scale 1.0, top-left origin of the page as displayed.
 * - isDeleted elements are stripped on save; version and versionNonce are kept on every element.
 * - appState is never persisted. No files map (image insertion is disabled — D7).
 * - schemaVersion > 1 opens read-only.
 */

export const SIDECAR_SCHEMA_VERSION = 1;

/** Element types that are never accepted into a v1 scene (D7: no images, no network-backed embeds). */
export const DISALLOWED_ELEMENT_TYPES: ReadonlySet<string> = new Set(["image", "embeddable", "iframe"]);

export interface SidecarElement {
  id: string;
  type: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

export interface SidecarPdfInfo {
  fileName: string;
  pageCount: number;
  sha256: string;
}

export interface SidecarV1 {
  schemaVersion: number;
  pdf: SidecarPdfInfo;
  /** Keyed by 1-based page number. */
  pages: Map<number, SidecarElement[]>;
}

export type ParseStatus = "ok" | "empty" | "recovered";

export interface ParseResult {
  status: ParseStatus;
  sidecar: SidecarV1;
  /** True when the file was written by a newer schema; the app must not save over it. */
  readOnly: boolean;
  warnings: string[];
}

export function emptySidecar(pdf: SidecarPdfInfo): SidecarV1 {
  return { schemaVersion: SIDECAR_SCHEMA_VERSION, pdf: { ...pdf }, pages: new Map() };
}

/**
 * Parses untrusted sidecar text. Never throws: malformed input yields status "recovered" with every
 * salvageable page and a warning per dropped item. The native side keeps the original bytes in the
 * version ring before the first save, so a recovery never destroys data.
 */
export function parseSidecar(text: string | null, pdf: SidecarPdfInfo): ParseResult {
  if (text === null || text.trim() === "") {
    return { status: "empty", sidecar: emptySidecar(pdf), readOnly: false, warnings: [] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return recovered(pdf, [`sidecar is not valid JSON (${(error as Error).message}); starting empty`]);
  }
  if (!isRecord(raw)) return recovered(pdf, ["sidecar root is not an object; starting empty"]);

  const warnings: string[] = [];
  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return recovered(pdf, ["sidecar has no valid schemaVersion; starting empty"]);
  }
  const readOnly = version > SIDECAR_SCHEMA_VERSION;
  if (readOnly) warnings.push(`sidecar schemaVersion ${version} is newer than ${SIDECAR_SCHEMA_VERSION}; opened read-only`);

  if (!isRecord(raw.pages)) {
    return { ...recovered(pdf, [...warnings, "sidecar has no pages object; starting empty"]), readOnly };
  }

  const pages = new Map<number, SidecarElement[]>();
  for (const [key, entry] of Object.entries(raw.pages)) {
    const page = parsePageKey(key);
    if (page === null) {
      warnings.push(`dropped page entry with invalid key "${key}"`);
      continue;
    }
    if (!isRecord(entry) || !Array.isArray(entry.elements)) {
      warnings.push(`dropped page ${page}: no elements array`);
      continue;
    }
    const elements: SidecarElement[] = [];
    entry.elements.forEach((el: unknown, i: number) => {
      const reason = elementRejection(el);
      if (reason) warnings.push(`page ${page}: dropped element #${i} (${reason})`);
      else elements.push({ ...(el as SidecarElement) });
    });
    if (elements.length > 0) pages.set(page, elements);
  }

  const sidecar: SidecarV1 = { schemaVersion: version, pdf: { ...pdf }, pages };
  return { status: warnings.length > 0 && !readOnly ? "recovered" : "ok", sidecar, readOnly, warnings };
}

function recovered(pdf: SidecarPdfInfo, warnings: string[]): ParseResult {
  return { status: "recovered", sidecar: emptySidecar(pdf), readOnly: false, warnings };
}

function parsePageKey(key: string): number | null {
  if (!/^[1-9][0-9]*$/.test(key)) return null;
  const n = Number(key);
  return Number.isSafeInteger(n) ? n : null;
}

function elementRejection(el: unknown): string | null {
  if (!isRecord(el)) return "not an object";
  if (typeof el.id !== "string" || el.id === "") return "missing id";
  if (typeof el.type !== "string") return "missing type";
  if (DISALLOWED_ELEMENT_TYPES.has(el.type)) return `type "${el.type}" is disabled in v1`;
  if (typeof el.version !== "number") return "missing version";
  if (typeof el.versionNonce !== "number") return "missing versionNonce";
  return null;
}

/** Keeps live, allowed elements. Strips isDeleted elements; never touches version / versionNonce. */
export function sanitizeElements(elements: readonly unknown[]): SidecarElement[] {
  const out: SidecarElement[] = [];
  for (const el of elements) {
    if (elementRejection(el) !== null) continue;
    const e = el as SidecarElement;
    if (e.isDeleted === true) continue;
    out.push(e);
  }
  return out;
}

/**
 * Deterministic serialization: numeric page order, empty pages omitted, isDeleted stripped,
 * 2-space indentation, trailing newline.
 */
export function serializeSidecar(sidecar: SidecarV1): string {
  const pages: Record<string, { elements: SidecarElement[] }> = {};
  const keys = [...sidecar.pages.keys()].sort((a, b) => a - b);
  for (const page of keys) {
    const elements = sanitizeElements(sidecar.pages.get(page) ?? []);
    if (elements.length > 0) pages[String(page)] = { elements };
  }
  const doc = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    pdf: { fileName: sidecar.pdf.fileName, pageCount: sidecar.pdf.pageCount, sha256: sidecar.pdf.sha256 },
    pages,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
