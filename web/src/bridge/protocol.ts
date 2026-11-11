/**
 * Typed BridgeProtocol between the web core and the Swift shell.
 *
 * The Swift mirror lives in Sources/PDFMarkupCore/BridgeMessages.swift. Both sides are checked against the
 * shared fixture Tests/PDFMarkupCoreTests/Fixtures/bridge-fixtures.json, so a field renamed on one side
 * breaks a test on the other.
 *
 * PDF bytes never travel through this protocol from native to web: openDocument carries a
 * pdfmarkup:// URL that the native WKURLSchemeHandler serves.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

export type StorageMode = "sibling" | "fallback";
export type Platform = "ios" | "macos" | "browser";
export type FlushReason = "background" | "close" | "conflict";
export type LogLevel = "info" | "warn" | "error";

// ---- Native → Web -------------------------------------------------------------------------------

export interface OpenDocumentMessage {
  type: "openDocument";
  /** pdfmarkup://app/__document__/<token>.pdf — served by the native scheme handler. */
  pdfURL: string;
  fileName: string;
  sha256: string;
  /** Raw sidecar text as read from disk, or null when no sidecar exists yet. */
  sidecarJSON: string | null;
  platform: Platform;
  storageMode: StorageMode;
}

export interface SaveResultMessage {
  type: "saveResult";
  requestId: string;
  ok: boolean;
  storageMode: StorageMode;
  error: string | null;
}

export interface FlushRequestMessage {
  type: "flushRequest";
  requestId: string;
  reason: FlushReason;
}

export interface ReloadSceneMessage {
  type: "reloadScene";
  sidecarJSON: string;
}

export interface RequestExportMessage {
  type: "requestExport";
}

export type NativeToWebMessage =
  | OpenDocumentMessage
  | SaveResultMessage
  | FlushRequestMessage
  | ReloadSceneMessage
  | RequestExportMessage;

// ---- Web → Native -------------------------------------------------------------------------------

export interface ReadyMessage {
  type: "ready";
  protocolVersion: number;
}

export interface SaveSceneMessage {
  type: "saveScene";
  requestId: string;
  sidecarJSON: string;
}

export interface DirtyChangedMessage {
  type: "dirtyChanged";
  dirty: boolean;
}

export interface FlushCompleteMessage {
  type: "flushComplete";
  requestId: string;
  /** True when the flush wrote something; false when nothing was dirty or the document is read-only. */
  saved: boolean;
}

export interface ExportReadyMessage {
  type: "exportReady";
  fileName: string;
  /** Web → native only: the flattened export. (Native → web PDF bytes go through the scheme handler.) */
  pdfBase64: string;
}

export interface ExportFailedMessage {
  type: "exportFailed";
  message: string;
}

export interface LogMessage {
  type: "log";
  level: LogLevel;
  message: string;
}

export type WebToNativeMessage =
  | ReadyMessage
  | SaveSceneMessage
  | DirtyChangedMessage
  | FlushCompleteMessage
  | ExportReadyMessage
  | ExportFailedMessage
  | LogMessage;

// ---- Validation ---------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isStorageMode = (v: unknown): v is StorageMode => v === "sibling" || v === "fallback";
const isPlatform = (v: unknown): v is Platform => v === "ios" || v === "macos" || v === "browser";
const isFlushReason = (v: unknown): v is FlushReason =>
  v === "background" || v === "close" || v === "conflict";

export class BridgeDecodeError extends Error {
  override name = "BridgeDecodeError";
}

/** Validates an untrusted value from the native side. Throws BridgeDecodeError on any mismatch. */
export function decodeNativeMessage(raw: unknown): NativeToWebMessage {
  const value: unknown = typeof raw === "string" ? safeJSONParse(raw) : raw;
  if (!isObj(value) || !isStr(value.type)) throw new BridgeDecodeError("message has no type");
  const m = value;
  switch (m.type) {
    case "openDocument":
      if (
        isStr(m.pdfURL) &&
        isStr(m.fileName) &&
        isStr(m.sha256) &&
        isStrOrNull(m.sidecarJSON) &&
        isPlatform(m.platform) &&
        isStorageMode(m.storageMode)
      ) {
        return {
          type: "openDocument",
          pdfURL: m.pdfURL,
          fileName: m.fileName,
          sha256: m.sha256,
          sidecarJSON: m.sidecarJSON,
          platform: m.platform,
          storageMode: m.storageMode,
        };
      }
      break;
    case "saveResult":
      if (isStr(m.requestId) && typeof m.ok === "boolean" && isStorageMode(m.storageMode) && isStrOrNull(m.error)) {
        return { type: "saveResult", requestId: m.requestId, ok: m.ok, storageMode: m.storageMode, error: m.error };
      }
      break;
    case "flushRequest":
      if (isStr(m.requestId) && isFlushReason(m.reason)) {
        return { type: "flushRequest", requestId: m.requestId, reason: m.reason };
      }
      break;
    case "reloadScene":
      if (isStr(m.sidecarJSON)) return { type: "reloadScene", sidecarJSON: m.sidecarJSON };
      break;
    case "requestExport":
      return { type: "requestExport" };
    default:
      throw new BridgeDecodeError(`unknown message type: ${m.type}`);
  }
  throw new BridgeDecodeError(`malformed ${m.type} message`);
}

/** Used by tests and the memory transport to check outgoing messages against the same schema as Swift. */
export function decodeWebMessage(raw: unknown): WebToNativeMessage {
  const value: unknown = typeof raw === "string" ? safeJSONParse(raw) : raw;
  if (!isObj(value) || !isStr(value.type)) throw new BridgeDecodeError("message has no type");
  const m = value;
  switch (m.type) {
    case "ready":
      if (typeof m.protocolVersion === "number") return { type: "ready", protocolVersion: m.protocolVersion };
      break;
    case "saveScene":
      if (isStr(m.requestId) && isStr(m.sidecarJSON)) {
        return { type: "saveScene", requestId: m.requestId, sidecarJSON: m.sidecarJSON };
      }
      break;
    case "dirtyChanged":
      if (typeof m.dirty === "boolean") return { type: "dirtyChanged", dirty: m.dirty };
      break;
    case "flushComplete":
      if (isStr(m.requestId) && typeof m.saved === "boolean") {
        return { type: "flushComplete", requestId: m.requestId, saved: m.saved };
      }
      break;
    case "exportReady":
      if (isStr(m.fileName) && isStr(m.pdfBase64)) {
        return { type: "exportReady", fileName: m.fileName, pdfBase64: m.pdfBase64 };
      }
      break;
    case "exportFailed":
      if (isStr(m.message)) return { type: "exportFailed", message: m.message };
      break;
    case "log":
      if ((m.level === "info" || m.level === "warn" || m.level === "error") && isStr(m.message)) {
        return { type: "log", level: m.level, message: m.message };
      }
      break;
    default:
      throw new BridgeDecodeError(`unknown message type: ${m.type}`);
  }
  throw new BridgeDecodeError(`malformed ${m.type} message`);
}

function safeJSONParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BridgeDecodeError("message is not valid JSON");
  }
}
