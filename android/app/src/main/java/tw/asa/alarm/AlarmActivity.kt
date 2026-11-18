package tw.asa.alarm

import android.annotation.SuppressLint
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.view.WindowManager
import android.widget.Toast
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * 鬧鐘響的時候蓋在鎖定畫面上的全螢幕。畫面是 assets/alarm.html（可以在電腦瀏覽器裡直接預覽）。
 * - 一般鬧鐘：答對算術才能按「我醒了」，同一天響越多次題目越難；只停掉這一個，後面的照樣會響。
 * - 起床確認：按「我醒了」5 分鐘後只震動、問一句「還醒著嗎？」，1 分鐘內沒按就變成大聲的鬧鐘。
 */
class AlarmActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var web: WebView
    private var checkMode = false
    private var started = System.currentTimeMillis()
    private val tick = object : Runnable {
        override fun run() {
            if (AlarmService.current == null) { finish(); return }   // 鬧鐘已經停了
            if (checkMode && !AlarmService.checking) {                // 確認沒按：變成一般鬧鐘
                checkMode = false; started = System.currentTimeMillis(); web.reload()
            }
            handler.postDelayed(this, 1000)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        window.statusBarColor = 0xFF0B0A18.toInt()
        window.navigationBarColor = 0xFF0B0A18.toInt()

        checkMode = AlarmService.checking
        web = WebView(this)
        web.setBackgroundColor(0xFF0B0A18.toInt())
        web.settings.javaScriptEnabled = true
        web.settings.allowFileAccess = true
        web.addJavascriptInterface(Bridge(), "AsaAlarm")
        web.loadUrl("file:///android_asset/alarm.html")
        setContentView(web)
    }

    /** 背景照片縮到螢幕大小，轉成 data URL 交給網頁。 */
    private fun photo(): String {
        val s = Store.background(this)
        if (s.isEmpty()) return ""
        return try {
            val uri = Uri.parse(s.substringBefore("?v="))
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
            val want = resources.displayMetrics.heightPixels
            var k = 1
            while (o.outHeight / (k * 2) >= want) k *= 2
            val bmp = contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = k })
            } ?: return ""
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out)
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) { "" }
    }

    inner class Bridge {
        @JavascriptInterface fun info(): String {
            val c = this@AlarmActivity
            val rest = Scheduler.upcoming(c).filter { it.millis <= System.currentTimeMillis() + 3 * 60 * 60 * 1000L }
            return JSONObject()
                .put("label", AlarmService.current?.label ?: tr("鬧鐘", "Alarm"))
                .put("check", checkMode)
                .put("n", Store.ringsToday(c).coerceAtLeast(1))
                .put("rest", rest.size).put("next", rest.firstOrNull()?.time ?: "")
                .put("sound", if (Store.sound(c).isEmpty()) "" else Store.soundName(c))
                .put("bg", photo())
                .put("since", System.currentTimeMillis() - started)
                .put("lang", java.util.Locale.getDefault().language)
                .toString()
        }

        @JavascriptInterface fun toast(msg: String) = runOnUiThread {
            Toast.makeText(this@AlarmActivity, msg, Toast.LENGTH_SHORT).show()
        }

        /** 答對了：停掉這一個，5 分鐘後確認還醒著，唸今天的簡報。 */
        @JavascriptInterface fun awake() = runOnUiThread {
            val c = this@AlarmActivity
            val item = AlarmService.current
            Scheduler.markAwake(c)
            Api.log(c, "awake", item)
            if (!AlarmService.isTest) Scheduler.scheduleCheck(c)
            stopService(Intent(c, AlarmService::class.java))
            Toast.makeText(c, tr("早安！5 分鐘後會確認你還醒著", "Good morning! I'll check you're still up in 5 minutes"), Toast.LENGTH_LONG).show()
            Voice.morningBrief(c)
            try {
                startActivity(Intent(c, MainActivity::class.java).putExtra("brief", true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
            } catch (_: Exception) { }
            finish()
        }

        /** 起床確認：按了「我醒著」。 */
        @JavascriptInterface fun checkOk() = runOnUiThread {
            stopService(Intent(this@AlarmActivity, AlarmService::class.java))
            Toast.makeText(this@AlarmActivity, tr("很好，起床囉！", "Great, have a good day!"), Toast.LENGTH_SHORT).show()
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(tick)
    }

    override fun onPause() {
        handler.removeCallbacks(tick)
        super.onPause()
    }

    @Deprecated("鬧鐘畫面不讓返回鍵直接關掉")
    override fun onBackPressed() { }
}
