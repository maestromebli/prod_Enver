package ua.enver.operator

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebChromeClient
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
    private val prefs by lazy { getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Як у Chrome PWA: системні панелі + safe-area, без приховування навігації.
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
            val ua = userAgentString.orEmpty()
            if (!ua.contains("EnverOperator/")) {
                userAgentString = "$ua EnverOperator/1.0"
            }
        }

        webView.webViewClient =
            object : WebViewClient() {
                @Deprecated("Deprecated in API 24")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean = false
            }

        webView.webChromeClient = WebChromeClient()

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

        val base = serverUrl.trimEnd('/')
        webView.loadUrl("$base/operator.html")
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
