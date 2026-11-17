package tw.asa.alarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.random.Random

/**
 * 鬧鐘響的時候蓋在鎖定畫面上的全螢幕。
 * - 一般鬧鐘：答對算術才能按「我醒了」，同一天響越多次題目越難；只停掉這一個，後面的照樣會響。
 * - 起床確認：按「我醒了」5 分鐘後只震動、問一句「還醒著嗎？」，1 分鐘內沒按就變成大聲的鬧鐘。
 */
class AlarmActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private var checkMode = false
    private val tick = object : Runnable {
        override fun run() {
            if (AlarmService.current == null) { finish(); return }   // 鬧鐘已經停了
            if (checkMode && !AlarmService.checking) { recreate(); return }   // 確認沒按：變成一般鬧鐘
            clock.text = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))
            handler.postDelayed(this, 1000)
        }
    }

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

        checkMode = AlarmService.checking
        val item = AlarmService.current
        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.gravity = Gravity.CENTER_HORIZONTAL
        val pad = Ui.dp(this, 28)
        root.setPadding(pad, Ui.dp(this, 70), pad, Ui.dp(this, 40))

        if (checkMode) buildCheck(root) else buildAlarm(root, item)
        setContentView(withBackground(root))
    }

    /** 背景：App 設定裡選的照片（上下各加一層暗色，字才看得清楚）；沒選就用原本的漸層。 */
    private fun withBackground(content: View): View {
        val frame = FrameLayout(this)
        val fill = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        val bmp = try {
            val uri = Uri.parse(Store.background(this).ifEmpty { throw IllegalStateException() })
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, o) }
            val want = resources.displayMetrics.heightPixels
            var s = 1
            while (o.outHeight / (s * 2) >= want) s *= 2           // 縮到螢幕大小就好，太大會吃記憶體
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = s }) }
        } catch (_: Exception) { null }
        if (bmp != null) {
            frame.addView(ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; setImageBitmap(bmp) }, fill)
            frame.addView(View(this).apply {
                background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                    intArrayOf(0x99000000.toInt(), 0x22000000, 0x00000000, 0x66000000, 0xDD000000.toInt()))
            }, fill)
        } else {
            frame.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF2A1F6B.toInt(), 0xFF7C3AED.toInt(), 0xFFFF5FA2.toInt(), 0xFFFFB347.toInt()))
        }
        frame.addView(content, fill)
        return frame
    }

    private fun shadow(t: TextView): TextView { t.setShadowLayer(12f, 0f, 2f, 0xAA000000.toInt()); return t }

    private fun spacer(root: LinearLayout) {
        root.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(1, 0, 1f) })
    }

    private fun buildCheck(root: LinearLayout) {
        root.addView(shadow(Ui.center(Ui.text(this, tr("起床確認", "Still awake?"), 20f))))
        clock = shadow(Ui.center(Ui.text(this, "", 96f, Ui.INK, true)))
        root.addView(clock)
        root.addView(shadow(Ui.center(Ui.text(this, tr("還醒著嗎？1 分鐘內沒按，就會大聲響", "Tap within a minute, or it rings loudly"), 16f, 0xEEFFFFFF.toInt()))))
        spacer(root)
        root.addView(Ui.button(this, tr("我醒著 ✓", "I'm awake ✓"), true) {
            stopService(Intent(this, AlarmService::class.java))
            Toast.makeText(this, tr("很好，起床囉！", "Great, have a good day!"), Toast.LENGTH_SHORT).show()
            finish()
        })
    }

    private fun buildAlarm(root: LinearLayout, item: AlarmItem?) {
        root.addView(shadow(Ui.center(Ui.text(this, item?.label ?: tr("鬧鐘", "Alarm"), 20f))))
        clock = shadow(Ui.center(Ui.text(this, "", 96f, Ui.INK, true)))
        root.addView(clock)

        val rest = Scheduler.upcoming(this).filter { it.millis <= System.currentTimeMillis() + 3 * 60 * 60 * 1000L }
        val hint = if (rest.isEmpty()) tr("這是這一輪最後一個鬧鐘", "This is the last alarm of this round") else tr("後面還有 ${rest.size} 個，下一個 ${rest[0].time}", "${rest.size} more to go, next at ${rest[0].time}")
        root.addView(shadow(Ui.center(Ui.text(this, hint, 15f, 0xEEFFFFFF.toInt()))))
        spacer(root)

        // 答對才算醒：今天響越多次，題目越難
        val n = Store.ringsToday(this)
        val (q, ans) = puzzle(n)
        val level = if (n >= 5) tr("（第 $n 個了，題目變難）", " (alarm #$n — harder now)") else if (n >= 3) tr("（第 $n 個，三個數）", " (alarm #$n — three numbers)") else ""
        root.addView(shadow(Ui.center(Ui.text(this, tr("答對才算醒：$q = ?", "Solve it to prove you're awake: $q = ?") + level, 17f))))
        val answer = EditText(this)
        answer.inputType = InputType.TYPE_CLASS_NUMBER
        answer.gravity = Gravity.CENTER
        answer.textSize = 26f
        answer.setTextColor(Ui.INK)
        answer.background = Ui.round(0x55000000, Ui.dp(this, 14).toFloat(), 0x55FFFFFF)
        val alp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 60))
        alp.topMargin = Ui.dp(this, 10)
        answer.layoutParams = alp
        root.addView(answer)

        // 只停掉這一個；後面排好的鬧鐘照樣會響。5 分鐘後再確認一次有沒有睡回去
        root.addView(Ui.button(this, tr("我醒了", "I'm awake"), true) {
            if (answer.text.toString().trim() == ans.toString()) {
                Scheduler.markAwake(this)
                Api.log(this, "awake", item)
                if (!AlarmService.isTest) Scheduler.scheduleCheck(this)
                stopService(Intent(this, AlarmService::class.java))
                Toast.makeText(this, tr("早安！5 分鐘後會確認你還醒著", "Good morning! I'll check you're still up in 5 minutes"), Toast.LENGTH_LONG).show()
                Voice.morningBrief(this)            // 唸今天的天氣、行程、待辦
                try {
                    startActivity(Intent(this, MainActivity::class.java).putExtra("brief", true)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                } catch (_: Exception) { }
                finish()
            } else {
                answer.setText("")
                Toast.makeText(this, tr("答錯了，再算一次", "Wrong answer, try again"), Toast.LENGTH_SHORT).show()
            }
        })
    }

    /** 第 1～2 個：三位數 + 三位數；第 3～4 個：三個三位數相加；第 5 個起：兩位數 × 個位數 + 三位數。 */
    private fun puzzle(n: Int): Pair<String, Int> {
        fun r3() = Random.nextInt(100, 1000)
        return when {
            n >= 5 -> { val a = Random.nextInt(12, 100); val b = Random.nextInt(3, 10); val c = r3(); "$a × $b + $c" to a * b + c }
            n >= 3 -> { val a = r3(); val b = r3(); val c = r3(); "$a + $b + $c" to a + b + c }
            else -> { val a = r3(); val b = r3(); "$a + $b" to a + b }
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
