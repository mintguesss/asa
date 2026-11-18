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
import android.Manifest
import android.content.pm.PackageManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.GeolocationPermissions
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
    private var splash: SunriseView? = null

    /** 收起開啟動畫，同時讓網頁的進場動畫開始播。 */
    private fun hideSplash() {
        val gone = { web.evaluateJavascript("window.splashGone && splashGone()", null); Unit }
        val sp = splash
        if (sp == null || sp.hiding) gone() else sp.hide(gone)     // 已經收過了（例如網頁重新載入）：直接讓網頁播進場動畫
    }
    private var geoAsk: Pair<String, GeolocationPermissions.Callback>? = null
    private var sr: SpeechRecognizer? = null
    private val REQ_GEO = 31
    private val REQ_MIC = 32

    private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
    private fun q(s: String) = org.json.JSONObject.quote(s)

    /** 語音輸入：用手機的語音辨識，邊說邊把字送到網頁；說完交給網頁去解析。 */
    private fun startListen() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("toast(" + q(tr("這支手機沒有語音辨識服務（需要 Google App）", "No speech recognition service on this phone (needs the Google app)")) + ")")
            return
        }
        sr?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        sr = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) = js("window.onVoiceState && onVoiceState('listening')")
            override fun onPartialResults(b: Bundle?) {
                val t = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
                js("window.onVoicePartial && onVoicePartial(" + q(t) + ")")
            }
            override fun onResults(b: Bundle?) {
                val t = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                js("window.onVoice && onVoice(" + q(t) + ")")
            }
            override fun onError(code: Int) = js("window.onVoiceError && onVoiceError($code)")
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, b: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (java.util.Locale.getDefault().language == "zh") "zh-TW" else java.util.Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        if (requestCode == REQ_GEO) { geoAsk?.let { it.second.invoke(it.first, ok, false) }; geoAsk = null }
        if (requestCode == REQ_MIC) { if (ok) startListen() else js("window.onVoiceError && onVoiceError(9)") }
    }

    override fun onDestroy() { sr?.destroy(); super.onDestroy() }

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
            userAgentString = "$userAgentString AsaApp/1.8"
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
                web.postDelayed({ hideSplash() }, 2500)        // 舊版網頁不會通知：載完 2.5 秒還沒收到就自己收
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            // 網頁要目前位置（天氣用）：先跟手機要定位權限
            override fun onGeolocationPermissionsShowPrompt(origin: String, cb: GeolocationPermissions.Callback) {
                if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    cb.invoke(origin, true, false)
                } else {
                    geoAsk = origin to cb
                    requestPermissions(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION), REQ_GEO)
                }
            }

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

        // 開啟動畫：太陽升起；網頁載入好就淡出（最多等 4 秒）
        splash = SunriseView(this)
        root.addView(splash, FrameLayout.LayoutParams(-1, -1))
        root.postDelayed({ hideSplash() }, 4000)

        setContentView(root)
        Scheduler.scheduleAll(this)
        Scheduler.scheduleSyncTick(this)
    }

    override fun onResume() {
        super.onResume()
        if (Store.url(this).isEmpty() || Store.token(this).isEmpty()) {
            hideSplash()
            openSetup()             // 第一次打開：先填網址和存取碼
            return
        }
        load(false)
        syncInBackground()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra("reload", false)) loadedFor = ""
        if (intent.getBooleanExtra("brief", false)) loadedFor = ""
    }

    /** 換了伺服器或存取碼才重新載入；force = 錯誤畫面按「重試」。 */
    private fun load(force: Boolean) {
        val key = Store.url(this) + "|" + Store.token(this)
        if (!force && key == loadedFor) return
        loadedFor = key
        errBox.visibility = View.GONE
        web.visibility = View.INVISIBLE
        // 剛按完「我醒了」：網頁打開早安簡報（App 已經唸過了，網頁只顯示）
        val brief = intent?.getBooleanExtra("brief", false) == true
        intent?.removeExtra("brief")
        web.loadUrl(Store.url(this) + "/?token=" + Uri.encode(Store.token(this)) + (if (brief) "&brief=1" else ""))
    }

    private fun showError(msg: String) {
        hideSplash()
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

    /** 調音量時用選好的鈴聲響 3 秒給你聽。 */
    private var preview: android.media.MediaPlayer? = null
    private var previewSaved = -1
    private val previewStop = Runnable {
        try { preview?.stop(); preview?.release() } catch (_: Exception) { }
        preview = null
        val audio = getSystemService(AUDIO_SERVICE) as android.media.AudioManager
        if (previewSaved >= 0) try { audio.setStreamVolume(android.media.AudioManager.STREAM_ALARM, previewSaved, 0) } catch (_: Exception) { }
        previewSaved = -1
    }
    private val ui = android.os.Handler(android.os.Looper.getMainLooper())
    private fun previewVolume() {
        if (AlarmService.current != null) return
        ui.removeCallbacks(previewStop)
        try {
            val audio = getSystemService(AUDIO_SERVICE) as android.media.AudioManager
            val st = android.media.AudioManager.STREAM_ALARM
            if (previewSaved < 0) previewSaved = audio.getStreamVolume(st)
            audio.setStreamVolume(st, Store.volumeSteps(this, audio.getStreamMaxVolume(st)), 0)
            if (preview == null) {
                val mine = Store.sound(this)
                val def = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                    ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
                val mp = android.media.MediaPlayer()
                mp.setAudioAttributes(android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ALARM)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build())
                try { mp.setDataSource(this, if (mine.isEmpty()) def else Uri.parse(mine)) }
                catch (_: Exception) { mp.reset(); mp.setAudioAttributes(android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_ALARM).build()); mp.setDataSource(this, def) }
                mp.isLooping = true; mp.prepare(); mp.start()
                preview = mp
            }
        } catch (_: Exception) { }
        ui.postDelayed(previewStop, 3000)
    }

    private fun pickFile(type: String, req: Int) {
        try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type), req) }
        catch (_: Exception) { js("toast(" + org.json.JSONObject.quote(tr("這支手機沒有可以選檔案的程式", "No file picker on this phone")) + ")") }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == 7) {
            fileCb?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCb = null
        }
        val picked = data?.data
        if ((requestCode == 41 || requestCode == 42) && resultCode == RESULT_OK && picked != null) {
            val name = Store.keep(this, picked)
            if (requestCode == 41) Store.setSound(this, picked.toString(), name.ifEmpty { tr("自選音樂", "Custom music") })
            else Store.setBackground(this, picked.toString())
            js("window.onNativePicked && onNativePicked()")
        }
        if (requestCode == 8) {         // 語音辨識的結果交給網頁
            val text = if (resultCode == RESULT_OK) data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull().orEmpty() else ""
            web.evaluateJavascript("window.onVoice && window.onVoice(" + org.json.JSONObject.quote(text) + ")", null)
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
        @JavascriptInterface fun version(): String = "2.4"
        // 鬧鐘的鈴聲、背景圖存在手機上，設定畫面在網頁的「設定 → 手機 App」
        @JavascriptInterface fun alarmLook(): String = org.json.JSONObject()
            .put("sound", if (Store.sound(this@MainActivity).isEmpty()) "" else Store.soundName(this@MainActivity))
            .put("bg", Store.background(this@MainActivity).isNotEmpty())
            .put("volume", Store.volume(this@MainActivity)).toString()
        @JavascriptInterface fun setVolume(v: Int) = runOnUiThread { Store.setVolume(this@MainActivity, v); previewVolume() }
        @JavascriptInterface fun setBackgroundData(data: String): Boolean = try {
            val f = java.io.File(filesDir, "alarm_bg.jpg")
            f.writeBytes(android.util.Base64.decode(data.substringAfter(','), android.util.Base64.DEFAULT))
            Store.setBackground(this@MainActivity, Uri.fromFile(f).toString() + "?v=" + System.currentTimeMillis())
            true
        } catch (_: Exception) { false }
        @JavascriptInterface fun pickSound() = runOnUiThread { pickFile("audio/*", 41) }
        @JavascriptInterface fun pickBackground() = runOnUiThread { pickFile("image/*", 42) }
        @JavascriptInterface fun resetSound() = Store.setSound(this@MainActivity, "", "")
        @JavascriptInterface fun resetBackground() = Store.setBackground(this@MainActivity, "")
        @JavascriptInterface fun testAlarm() = Scheduler.testAlarm(this@MainActivity, 10)
        @JavascriptInterface fun testCheck() = Scheduler.scheduleCheck(this@MainActivity, 10)
        @JavascriptInterface fun ready() = runOnUiThread { hideSplash() }
        @JavascriptInterface fun speak(text: String) = Voice.speak(this@MainActivity, text)
        @JavascriptInterface fun stopSpeak() = Voice.stop()
        @JavascriptInterface fun stopListen() = runOnUiThread { sr?.stopListening() }
        @JavascriptInterface fun listen() = runOnUiThread { startListen() }
        @JavascriptInterface fun listenDialog() = runOnUiThread {
            val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (java.util.Locale.getDefault().language == "zh") "zh-TW" else java.util.Locale.getDefault().toLanguageTag())
                .putExtra(RecognizerIntent.EXTRA_PROMPT, tr("說一句話，例如「明天下午三點開會」", "Say something, e.g. \"meeting tomorrow at 3pm\""))
            try { startActivityForResult(i, 8) } catch (_: Exception) {
                web.evaluateJavascript("toast(" + org.json.JSONObject.quote(tr("這支手機沒有語音辨識，可以用鍵盤上的麥克風", "No speech recognition on this phone; try the keyboard mic")) + ")", null)
            }
        }
    }
}
