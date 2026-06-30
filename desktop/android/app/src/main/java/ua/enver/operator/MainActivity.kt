package ua.enver.operator

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.os.Message
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var jsBridge: EnverJsBridge
    private val prefs by lazy { getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }
    private var serverBaseUrl: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        jsBridge = EnverJsBridge(this) { if (::webView.isInitialized) webView else null }

        val serverUrl = prefs.getString(KEY_SERVER_URL, null)?.trim().orEmpty()
        if (serverUrl.isEmpty()) {
            showServerUrlDialog(onSaved = { url ->
                prefs.edit().putString(KEY_SERVER_URL, url).apply()
                startWithUrl(url)
            })
            return
        }

        startWithUrl(serverUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun startWithUrl(serverUrl: String) {
        serverBaseUrl = serverUrl.trimEnd('/')
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, true)

        webView = WebView(this)
        setContentView(webView)

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            cacheMode = WebSettings.LOAD_DEFAULT
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            val ua = userAgentString.orEmpty()
            if (!ua.contains("EnverOperator/")) {
                userAgentString = "$ua EnverOperator/${BuildConfig.VERSION_NAME}"
            }
        }

        webView.addJavascriptInterface(jsBridge, "EnverNative")

        webView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    if (request?.isForMainFrame != true) return false
                    val url = request.url?.toString().orEmpty()
                    if (url.isBlank()) return false
                    if (isSameServerUrl(url)) return false
                    view?.loadUrl(url)
                    return true
                }

                @Deprecated("Deprecated in API 24")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    if (url.isNullOrBlank()) return false
                    if (isSameServerUrl(url)) return false
                    view?.loadUrl(url)
                    return true
                }
            }

        webView.webChromeClient =
            object : WebChromeClient() {
                override fun onCreateWindow(
                    view: WebView?,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: Message?
                ): Boolean {
                    val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                    transport.webView = webView
                    resultMsg.sendToTarget()
                    return true
                }
            }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (::webView.isInitialized && webView.canGoBack()) {
                        webView.goBack()
                    }
                }
            }
        )

        webView.loadUrl("$serverBaseUrl/operator.html")
    }

    private fun isSameServerUrl(url: String): Boolean {
        val base = serverBaseUrl
        if (base.isBlank()) return true
        return url == base ||
            url.startsWith("$base/") ||
            url.startsWith("$base?") ||
            url.startsWith("$base#")
    }

    override fun onResume() {
        super.onResume()
        if (::webView.isInitialized) {
            webView.evaluateJavascript(
                "window.__enverCheckForUpdates && window.__enverCheckForUpdates()",
                null
            )
        }
    }

    private fun showServerUrlDialog(onSaved: (String) -> Unit) {
        val input =
            EditText(this).apply {
                hint = getString(R.string.server_url_hint)
                setSingleLine()
            }
        val density = resources.displayMetrics.density
        val pad = (16 * density).toInt()
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, 0)
                addView(input)
            }

        AlertDialog.Builder(this)
            .setTitle(R.string.server_url_title)
            .setMessage(R.string.server_url_message)
            .setView(layout)
            .setCancelable(false)
            .setPositiveButton(R.string.save) { _, _ ->
                val url = input.text.toString().trim()
                if (url.isNotEmpty()) {
                    onSaved(url)
                } else {
                    showServerUrlDialog(onSaved)
                }
            }
            .show()
    }

    companion object {
        private const val PREFS_NAME = "enver_operator"
        private const val KEY_SERVER_URL = "serverUrl"
    }
}
