import Foundation

/// Swift mirror of `web/src/bridge/protocol.ts`. Both sides decode the shared fixture
/// `Tests/PDFMarkupCoreTests/Fixtures/bridge-fixtures.json`, so a schema drift fails a test.
///
/// PDF bytes never travel native → web through this protocol: `openDocument` carries a
/// `pdfmarkup://` URL that the app's `WKURLSchemeHandler` serves.
public enum BridgeProtocol {
    public static let version = 1
    /// Name of the WKScriptMessageHandler the web core posts to.
    public static let handlerName = "pdfMarkupBridge"
    /// JavaScript entry point the native side calls with one JSON string argument.
    public static let receiveFunction = "window.__pdfMarkupReceive"
}

public enum StorageMode: String, Codable, Sendable {
    case sibling
    case fallback
}

public enum BridgePlatform: String, Codable, Sendable {
    case ios
    case macos
    case browser
}

public enum FlushReason: String, Codable, Sendable {
    case background
    case close
    case conflict
}

public enum BridgeLogLevel: String, Codable, Sendable {
    case info
    case warn
    case error
}

// MARK: - Native → Web

public enum NativeToWebMessage: Equatable, Sendable {
    case openDocument(pdfURL: String, fileName: String, sha256: String, sidecarJSON: String?, platform: BridgePlatform, storageMode: StorageMode)
    case saveResult(requestId: String, ok: Bool, storageMode: StorageMode, error: String?)
    case flushRequest(requestId: String, reason: FlushReason)
    case reloadScene(sidecarJSON: String)
    case requestExport
}

// MARK: - Web → Native

public enum WebToNativeMessage: Equatable, Sendable {
    case ready(protocolVersion: Int)
    case saveScene(requestId: String, sidecarJSON: String)
    case dirtyChanged(dirty: Bool)
    case flushComplete(requestId: String, saved: Bool)
    /// Web → native only: the flattened export. (Native → web PDF bytes use the scheme handler.)
    case exportReady(fileName: String, pdfBase64: String)
    case exportFailed(message: String)
    case log(level: BridgeLogLevel, message: String)
}

// MARK: - Codable (tagged by "type")

private enum TypeKey: String, CodingKey { case type }

extension NativeToWebMessage: Codable {
    private enum K: String, CodingKey {
        case type, pdfURL, fileName, sha256, sidecarJSON, platform, storageMode, requestId, ok, error, reason
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "openDocument":
            self = try .openDocument(
                pdfURL: c.decode(String.self, forKey: .pdfURL),
                fileName: c.decode(String.self, forKey: .fileName),
                sha256: c.decode(String.self, forKey: .sha256),
                sidecarJSON: c.decodeNullable(String.self, forKey: .sidecarJSON),
                platform: c.decode(BridgePlatform.self, forKey: .platform),
                storageMode: c.decode(StorageMode.self, forKey: .storageMode)
            )
        case "saveResult":
            self = try .saveResult(
                requestId: c.decode(String.self, forKey: .requestId),
                ok: c.decode(Bool.self, forKey: .ok),
                storageMode: c.decode(StorageMode.self, forKey: .storageMode),
                error: c.decodeNullable(String.self, forKey: .error)
            )
        case "flushRequest":
            self = try .flushRequest(
                requestId: c.decode(String.self, forKey: .requestId),
                reason: c.decode(FlushReason.self, forKey: .reason)
            )
        case "reloadScene":
            self = try .reloadScene(sidecarJSON: c.decode(String.self, forKey: .sidecarJSON))
        case "requestExport":
            self = .requestExport
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown message type \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case let .openDocument(pdfURL, fileName, sha256, sidecarJSON, platform, storageMode):
            try c.encode("openDocument", forKey: .type)
            try c.encode(pdfURL, forKey: .pdfURL)
            try c.encode(fileName, forKey: .fileName)
            try c.encode(sha256, forKey: .sha256)
            try c.encode(sidecarJSON, forKey: .sidecarJSON) // explicit null, as the TS decoder requires
            try c.encode(platform, forKey: .platform)
            try c.encode(storageMode, forKey: .storageMode)
        case let .saveResult(requestId, ok, storageMode, error):
            try c.encode("saveResult", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(ok, forKey: .ok)
            try c.encode(storageMode, forKey: .storageMode)
            try c.encode(error, forKey: .error)
        case let .flushRequest(requestId, reason):
            try c.encode("flushRequest", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(reason, forKey: .reason)
        case let .reloadScene(sidecarJSON):
            try c.encode("reloadScene", forKey: .type)
            try c.encode(sidecarJSON, forKey: .sidecarJSON)
        case .requestExport:
            try c.encode("requestExport", forKey: .type)
        }
    }
}

extension WebToNativeMessage: Codable {
    private enum K: String, CodingKey {
        case type, protocolVersion, requestId, sidecarJSON, dirty, saved, fileName, pdfBase64, message, level
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            self = try .ready(protocolVersion: c.decode(Int.self, forKey: .protocolVersion))
        case "saveScene":
            self = try .saveScene(requestId: c.decode(String.self, forKey: .requestId), sidecarJSON: c.decode(String.self, forKey: .sidecarJSON))
        case "dirtyChanged":
            self = try .dirtyChanged(dirty: c.decode(Bool.self, forKey: .dirty))
        case "flushComplete":
            self = try .flushComplete(requestId: c.decode(String.self, forKey: .requestId), saved: c.decode(Bool.self, forKey: .saved))
        case "exportReady":
            self = try .exportReady(fileName: c.decode(String.self, forKey: .fileName), pdfBase64: c.decode(String.self, forKey: .pdfBase64))
        case "exportFailed":
            self = try .exportFailed(message: c.decode(String.self, forKey: .message))
        case "log":
            self = try .log(level: c.decode(BridgeLogLevel.self, forKey: .level), message: c.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "unknown message type \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case let .ready(v):
            try c.encode("ready", forKey: .type)
            try c.encode(v, forKey: .protocolVersion)
        case let .saveScene(requestId, sidecarJSON):
            try c.encode("saveScene", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(sidecarJSON, forKey: .sidecarJSON)
        case let .dirtyChanged(dirty):
            try c.encode("dirtyChanged", forKey: .type)
            try c.encode(dirty, forKey: .dirty)
        case let .flushComplete(requestId, saved):
            try c.encode("flushComplete", forKey: .type)
            try c.encode(requestId, forKey: .requestId)
            try c.encode(saved, forKey: .saved)
        case let .exportReady(fileName, pdfBase64):
            try c.encode("exportReady", forKey: .type)
            try c.encode(fileName, forKey: .fileName)
            try c.encode(pdfBase64, forKey: .pdfBase64)
        case let .exportFailed(message):
            try c.encode("exportFailed", forKey: .type)
            try c.encode(message, forKey: .message)
        case let .log(level, message):
            try c.encode("log", forKey: .type)
            try c.encode(level, forKey: .level)
            try c.encode(message, forKey: .message)
        }
    }
}

private extension KeyedDecodingContainer {
    /// Requires the key to be present (null allowed), matching the TS decoder's `string | null` fields.
    func decodeNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
        guard contains(key) else {
            throw DecodingError.keyNotFound(key, .init(codingPath: codingPath, debugDescription: "missing \(key.stringValue)"))
        }
        return try decodeNil(forKey: key) ? nil : decode(type, forKey: key)
    }
}

/// JSON encoding/decoding for bridge messages; deterministic key order.
public enum BridgeCodec {
    public static func encode(_ message: NativeToWebMessage) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(message)
        return String(decoding: data, as: UTF8.self)
    }

    public static func decodeWebMessage(_ json: String) throws -> WebToNativeMessage {
        try JSONDecoder().decode(WebToNativeMessage.self, from: Data(json.utf8))
    }

    public static func decodeNativeMessage(_ json: String) throws -> NativeToWebMessage {
        try JSONDecoder().decode(NativeToWebMessage.self, from: Data(json.utf8))
    }
}
