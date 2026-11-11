import CryptoKit
import Foundation

public enum PDFFingerprint {
    /// Lowercase hex SHA-256 of the PDF bytes (keys the fallback store and the version ring).
    public static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
