import Foundation
import WebKit

/// Reads the open page's icon links and downloads the first that loads as
/// an image. Native does the download because the wallet WebView's fetch
/// is bound by CORS, and a cookie-free session keeps the request from
/// carrying the page's login. `PAGE_ICON_MAX_BYTES` in `src/definitions.ts`
/// is `maxBytes`.
enum PageIcon {
    static let maxBytes = 65_536
    private static let maxCandidates = 4
    private static let imageTypes: Set<String> = [
        "image/png", "image/jpeg", "image/gif", "image/webp",
        "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"
    ]

    /// Runs in its own content world, so the page's scripts can't replace
    /// the DOM methods it calls. The page still chooses its links.
    private static let candidatesScript = """
        const links = [...document.querySelectorAll("link[rel][href]")];
        const pick = (word) => links
            .filter((link) => link.rel.toLowerCase().split(/\\s+/).includes(word))
            .map((link) => link.href);
        return {
            origin: location.origin,
            urls: [...pick("apple-touch-icon"), ...pick("icon"), new URL("/favicon.ico", location.href).href],
        };
        """

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 10
        return URLSession(configuration: configuration)
    }()

    static func read(from webView: WKWebView, completion: @escaping ([String: Any]) -> Void) {
        webView.callAsyncJavaScript(candidatesScript, arguments: [:], in: nil, in: .defaultClient) { result in
            guard case .success(let value) = result,
                  let object = value as? [String: Any],
                  let origin = object["origin"] as? String,
                  let urls = object["urls"] as? [String] else {
                completion(["origin": NSNull(), "dataUrl": NSNull()])
                return
            }
            let candidates = urls
                .compactMap { URL(string: $0) }
                .filter { $0.scheme?.lowercased() == "https" }
            fetchFirst(Array(candidates.prefix(maxCandidates))) { dataUrl in
                DispatchQueue.main.async {
                    completion(["origin": origin, "dataUrl": dataUrl ?? NSNull()])
                }
            }
        }
    }

    private static func fetchFirst(_ urls: [URL], completion: @escaping (String?) -> Void) {
        Task {
            for url in urls {
                if let dataUrl = await fetch(url) {
                    completion(dataUrl)
                    return
                }
            }
            completion(nil)
        }
    }

    /// Streams the body and stops at `maxBytes`, so a page can't point this
    /// at something huge and have it buffered whole.
    private static func fetch(_ url: URL) async -> String? {
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        guard let (bytes, response) = try? await session.bytes(for: request) else { return nil }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.scheme?.lowercased() == "https",
              let type = http.mimeType?.lowercased(), imageTypes.contains(type),
              http.expectedContentLength <= Int64(maxBytes) else {
            bytes.task.cancel()
            return nil
        }
        var data = Data()
        data.reserveCapacity(maxBytes)
        do {
            for try await byte in bytes {
                if data.count == maxBytes {
                    bytes.task.cancel()
                    return nil
                }
                data.append(byte)
            }
        } catch {
            return nil
        }
        guard !data.isEmpty else { return nil }
        return "data:\(type);base64,\(data.base64EncodedString())"
    }
}
