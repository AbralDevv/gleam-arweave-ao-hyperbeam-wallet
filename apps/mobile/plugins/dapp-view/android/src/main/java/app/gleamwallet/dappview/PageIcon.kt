package app.gleamwallet.dappview

import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Reads the open page's icon links and downloads the first that loads as
 * an image. Native does the download because the wallet WebView's fetch is
 * bound by CORS, and this connection carries none of the dApp profile's
 * cookies. `PAGE_ICON_MAX_BYTES` in `src/definitions.ts` is [MAX_BYTES].
 */
internal object PageIcon {
    const val MAX_BYTES = 65_536
    private const val MAX_CANDIDATES = 4
    private const val TIMEOUT_MS = 8_000
    private val IMAGE_TYPES = setOf(
        "image/png", "image/jpeg", "image/gif", "image/webp",
        "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml",
    )

    private val executor = Executors.newSingleThreadExecutor()

    /** The page chooses its links; the origin comes from the view, not the page. */
    private const val CANDIDATES_SCRIPT = "(function () {" +
        "var links = Array.prototype.slice.call(document.querySelectorAll('link[rel][href]'));" +
        "function pick(word) { return links.filter(function (link) {" +
        "return String(link.rel).toLowerCase().split(/\\s+/).indexOf(word) !== -1; }).map(function (link) { return String(link.href); }); }" +
        "return pick('apple-touch-icon').concat(pick('icon'), [new URL('/favicon.ico', location.href).href]);" +
        "})()"

    fun read(view: WebView, completion: (JSObject) -> Unit) {
        val origin = view.url?.let { originOf(Uri.parse(it)) }
        if (origin == null) {
            completion(JSObject().put("origin", JSONObject.NULL).put("dataUrl", JSONObject.NULL))
            return
        }
        view.evaluateJavascript(CANDIDATES_SCRIPT) { result ->
            val candidates = parseUrls(result)
            executor.execute {
                val dataUrl = candidates.firstNotNullOfOrNull { fetch(it) }
                completion(JSObject().put("origin", origin).put("dataUrl", dataUrl ?: JSONObject.NULL))
            }
        }
    }

    private fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host ?: return null
        if (scheme != "http" && scheme != "https") return null
        return if (uri.port == -1) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }

    private fun parseUrls(result: String?): List<String> {
        val array = try {
            JSONArray(result ?: return emptyList())
        } catch (_: Exception) {
            return emptyList()
        }
        return (0 until array.length())
            .mapNotNull { array.opt(it) as? String }
            .filter { Uri.parse(it).scheme?.lowercase() == "https" }
            .take(MAX_CANDIDATES)
    }

    private fun fetch(url: String): String? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                useCaches = false
                // Never follows an https page to http.
                instanceFollowRedirects = true
            }
            if (connection.responseCode != 200) return null
            if (connection.url.protocol.lowercase() != "https") return null
            val type = connection.contentType?.substringBefore(';')?.trim()?.lowercase() ?: return null
            if (type !in IMAGE_TYPES) return null
            val bytes = readAtMost(connection, MAX_BYTES) ?: return null
            if (bytes.isEmpty()) return null
            "data:$type;base64,${Base64.encodeToString(bytes, Base64.NO_WRAP)}"
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    /** Null once the body passes [limit], so a page can't point this at something huge. */
    private fun readAtMost(connection: HttpURLConnection, limit: Int): ByteArray? {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8_192)
        connection.inputStream.use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read == -1) break
                if (out.size() + read > limit) return null
                out.write(buffer, 0, read)
            }
        }
        return out.toByteArray()
    }
}
