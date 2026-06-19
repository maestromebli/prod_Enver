package ua.enver.operator

import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.DocumentsContract
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class EnverJsBridge(
    private val activity: AppCompatActivity,
    private val webViewProvider: () -> WebView?
) {
    private var pendingCallbackId: String? = null

    val folderPickerLauncher =
        activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callbackId = pendingCallbackId
            pendingCallbackId = null
            if (callbackId == null) return@registerForActivityResult

            val uri = result.data?.data
            val path =
                if (result.resultCode == AppCompatActivity.RESULT_OK && uri != null) {
                    persistTreePermission(uri)
                    treeUriToPath(uri)
                } else {
                    ""
                }
            dispatchFolderResult(callbackId, path)
        }

    @JavascriptInterface
    fun pickFolder(callbackId: String, title: String?) {
        activity.runOnUiThread {
            pendingCallbackId = callbackId
            val intent =
                Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    )
                    if (!title.isNullOrBlank()) {
                        putExtra("android.content.extra.SHOW_ADVANCED", true)
                    }
                }
            folderPickerLauncher.launch(intent)
        }
    }

    private fun persistTreePermission(uri: Uri) {
        try {
            val flags =
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            activity.contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: SecurityException) {
            /* ignore */
        }
    }

    private fun treeUriToPath(uri: Uri): String {
        if (uri.scheme == "file") {
            return uri.path.orEmpty().ifBlank { uri.toString() }
        }

        val docId =
            try {
                DocumentsContract.getTreeDocumentId(uri)
            } catch (_: Exception) {
                return uri.toString()
            }

        if (docId.startsWith("primary:")) {
            val relative = docId.removePrefix("primary:")
            val base = Environment.getExternalStorageDirectory().absolutePath
            return if (relative.isEmpty()) base else "$base/$relative"
        }

        if (docId.contains(":")) {
            return docId.substringAfter(":")
        }

        return uri.toString()
    }

    private fun dispatchFolderResult(callbackId: String, path: String) {
        val quotedId = JSONObject.quote(callbackId)
        val quotedPath = JSONObject.quote(path)
        webViewProvider()?.evaluateJavascript(
            "window.__enverOnFolderPicked($quotedId, $quotedPath)",
            null
        )
    }
}
