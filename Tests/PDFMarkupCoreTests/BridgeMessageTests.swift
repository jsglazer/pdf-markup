import Foundation
import Testing
@testable import PDFMarkupCore

@Suite("Bridge messages (shared fixtures with the web core)")
struct BridgeMessageTests {
    struct Fixtures: Decodable {
        let nativeToWeb: [JSONValue]
        let webToNative: [JSONValue]
        let invalidNativeToWeb: [JSONValue]
    }

    /// Minimal JSON value so fixtures can be re-serialized one message at a time.
    enum JSONValue: Codable, Equatable {
        case string(String), number(Double), bool(Bool), null, array([JSONValue]), object([String: JSONValue])

        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let n = try? c.decode(Double.self) { self = .number(n) }
            else if let s = try? c.decode(String.self) { self = .string(s) }
            else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
            else { self = .object(try c.decode([String: JSONValue].self)) }
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.singleValueContainer()
            switch self {
            case let .string(s): try c.encode(s)
            case let .number(n): try c.encode(n)
            case let .bool(b): try c.encode(b)
            case .null: try c.encodeNil()
            case let .array(a): try c.encode(a)
            case let .object(o): try c.encode(o)
            }
        }

        var json: String {
            let e = JSONEncoder()
            e.outputFormatting = [.sortedKeys]
            return String(decoding: (try? e.encode(self)) ?? Data(), as: UTF8.self)
        }
    }

    func loadFixtures() throws -> Fixtures {
        let url = try #require(Bundle.module.url(forResource: "bridge-fixtures", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixtures.self, from: Data(contentsOf: url))
    }

    @Test func decodesEveryNativeToWebFixtureAndReencodesIdentically() throws {
        let fixtures = try loadFixtures()
        #expect(fixtures.nativeToWeb.count == 7)
        for fixture in fixtures.nativeToWeb {
            let message = try BridgeCodec.decodeNativeMessage(fixture.json)
            let reencoded = try JSONDecoder().decode(JSONValue.self, from: Data(BridgeCodec.encode(message).utf8))
            #expect(reencoded == fixture)
        }
    }

    @Test func decodesEveryWebToNativeFixture() throws {
        let fixtures = try loadFixtures()
        for fixture in fixtures.webToNative {
            let message = try BridgeCodec.decodeWebMessage(fixture.json)
            let reencoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(message))
            #expect(reencoded == fixture)
        }
    }

    @Test func rejectsInvalidMessages() throws {
        for fixture in try loadFixtures().invalidNativeToWeb {
            #expect(throws: (any Error).self) { try BridgeCodec.decodeNativeMessage(fixture.json) }
        }
    }

    @Test func openDocumentEncodesExplicitNullSidecar() throws {
        let json = try BridgeCodec.encode(.openDocument(pdfURL: "pdfmarkup://app/__document__/x.pdf", fileName: "a.pdf", sha256: "s", sidecarJSON: nil, platform: .ios, storageMode: .sibling))
        #expect(json.contains("\"sidecarJSON\":null"))
        #expect(!json.contains("base64"))
    }
}
