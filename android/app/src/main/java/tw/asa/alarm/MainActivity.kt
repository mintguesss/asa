package tw.asa.alarm

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * 主畫面：直接顯示電腦上的 Asa 網頁（日曆、待辦、鬧鐘都在這裡），同時負責響鈴。
 * 網頁改了鬧鐘會呼叫 AsaNative.sync()，手機馬上重排，不用另外按同步。
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var errBox: LinearLayout
    private lateinit var errText: TextView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var loadedFor = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Ui.BG
        window.navigationBarColor = Ui.BG

        val root = FrameLayout(this)
        root.setBackgroundColor(Ui.BG)
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener { v, insets ->
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
                WindowInsets.CONSUMED
            }
        }

        web = WebView(this)
        web.setBackgroundColor(Ui.BG)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            userAgentString = "$userAgentString AsaApp/1.2"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.addJavascriptInterface(Bridge(), "AsaNative")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "asa") { startActivity(Intent(Intent.ACTION_VIEW, u).setClass(this@MainActivity, SetupActivity::class.java)); return true }
                val base = Uri.parse(Store.url(this@MainActivity))
                if (u.host == base.host && u.port == base.port && !u.path.orEmpty().endsWith(".apk")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) { }   // 外部連結交給瀏覽器
                return true
            }

            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (req.isForMainFrame) showError(err.description?.toString() ?: "")
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (errBox.visibility != View.VISIBLE) web.visibility = View.VISIBLE
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                return try { startActivityForResult(params.createIntent(), 7); true } catch (_: Exception) { fileCb = null; false }
            }
        }
        web.setDownloadListener { url, _, _, _, _ ->
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } catch (_: Exception) { }
        }
        root.addView(web, FrameLayout.LayoutParams(-1, -1))

        // 連不上電腦時的畫面
        errBox = LinearLayout(this)
        errBox.orientation = LinearLayout.VERTICAL
        errBox.gravity = Gravity.CENTER
        val pad = Ui.dp(this, 28)
        errBox.setPadding(pad, pad, pad, pad)
        errBox.addView(Ui.center(Ui.text(this, tr("連不上電腦上的 Asa", "Can't reach Asa on your computer"), 20f, Ui.INK, true)))
        errText = Ui.center(Ui.text(this, "", 14f, Ui.MUTE))
        errText.setPadding(0, Ui.dp(this, 10), 0, Ui.dp(this, 6))
        errBox.addView(errText)
        errBox.addView(Ui.center(Ui.text(this, tr("鬧鐘不受影響：上次同步到的鬧鐘照樣會響。", "Alarms still ring: the last synced alarms stay scheduled."), 14f, Ui.MUTE)))
        errBox.addView(Ui.button(this, tr("重試", "Retry"), true) { load(true) })
        errBox.addView(Ui.button(this, tr("App 設定", "App settings"), false) { openSetup() })
        errBox.visibility = View.GONE
        root.addView(errBox, FrameLayout.LayoutParams(-1, -1))

        setContentView(root)
        Scheduler.scheduleAll(this)
        Scheduler.scheduleSyncTick(this)
    }

    override fun onResume() {
        super.onResume()
        if (Store.url(this).isEmpty() || Store.token(this).isEmpty()) {
            openSetup()             // 第一次打開：先填網址和存取碼
            return
        }
        load(false)
        syncInBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("reload", false)) loadedFor = ""
    }

    /** 換了伺服器或存取碼才重新載入；force = 錯誤畫面按「重試」。 */
    private fun load(force: Boolean) {
        val key = Store.url(this) + "|" + Store.token(this)
        if (!force && key == loadedFor) return
        loadedFor = key
        errBox.visibility = View.GONE
        web.visibility = View.INVISIBLE
        web.loadUrl(Store.url(this) + "/?token=" + Uri.encode(Store.token(this)))
    }

    private fun showError(msg: String) {
        web.visibility = View.INVISIBLE
        errText.text = Store.url(this) + "\n" + msg
        errBox.visibility = View.VISIBLE
    }

    private fun syncInBackground() {
        thread {
            Scheduler.sync(applicationContext)
            runOnUiThread { web.evaluateJavascript("window.onNativeSync && window.onNativeSync()", null) }
        }
    }

    private fun openSetup() = startActivity(Intent(this, SetupActivity::class.java))

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 7) {
            fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCb = null
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    /** 網頁裡的 JavaScript 叫得到的功能（window.AsaNative）。 */
    inner class Bridge {
        @JavascriptInterface fun sync() = syncInBackground()
        @JavascriptInterface fun openSetup() = runOnUiThread { this@MainActivity.openSetup() }
        @JavascriptInterface fun version(): String = "1.2"
    }
}
