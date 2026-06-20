import Foundation

/// One block of a file to PUT to Azure: where it lives in the source file and its
/// Azure block id.
struct ChunkRange: Equatable {
    let index: Int
    let offset: Int
    let length: Int
    let blockId: String
}

/// Block-id generation and file slicing for resilient block uploads.
///
/// Mirrors the web client (`uploadUtils.js`) exactly so the server's committed block
/// list is valid: each block id is a 64-byte buffer holding the block index as a
/// big-endian `Int64` in the last 8 bytes, base64-encoded. Fixed length is mandatory —
/// Azure rejects a block list whose ids differ in length.
enum BlockUpload {
    static func blockId(index: Int) -> String {
        var buffer = [UInt8](repeating: 0, count: 64)
        let value = Int64(index).bigEndian
        withUnsafeBytes(of: value) { raw in
            // Write the 8 big-endian bytes into the last 8 positions (56..<64).
            for i in 0..<8 { buffer[56 + i] = raw[i] }
        }
        return Data(buffer).base64EncodedString()
    }

    /// Builds the Azure "Put Block" URL for a SAS + block id: `{sas}&comp=block&blockid=<b64>`.
    /// The block id is percent-encoded so base64 `+`, `/`, `=` survive as query values, and the
    /// separator adapts to whether the SAS already has a query string. Pure so both the request
    /// builder and tests share one definition. Returns `nil` only if the result isn't a valid URL.
    static func blockPutURL(sasUrl: String, blockId: String) -> URL? {
        let encodedId = blockId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? blockId
        let separator = sasUrl.contains("?") ? "&" : "?"
        return URL(string: "\(sasUrl)\(separator)comp=block&blockid=\(encodedId)")
    }

    /// Splits a file of `fileSize` bytes into `chunkSize` ranges, each tagged with its
    /// block id. The final range holds the remainder; an exact multiple yields no
    /// trailing empty block, and a zero-length file yields no ranges.
    static func chunkRanges(fileSize: Int, chunkSize: Int) -> [ChunkRange] {
        guard fileSize > 0, chunkSize > 0 else { return [] }
        var ranges: [ChunkRange] = []
        var offset = 0
        var index = 0
        while offset < fileSize {
            let length = min(chunkSize, fileSize - offset)
            ranges.append(ChunkRange(index: index, offset: offset, length: length,
                                     blockId: blockId(index: index)))
            offset += length
            index += 1
        }
        return ranges
    }
}
