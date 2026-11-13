package tw.lifehub.alarm

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.random.Random

/** 鬧鐘響的時候蓋在鎖定畫面上的全螢幕。 */
class AlarmActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var clock: TextView
    private val tick = object : Runnable {
        override fun run() {
            if (AlarmService.current == null) { finish(); return }   // 鬧鐘已經停了
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

        val item = AlarmService.current
        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.gravity = Gravity.CENTER_HORIZONTAL
        root.background = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0xFF2A1F6B.toInt(), 0xFF7C3AED.toInt(), 0xFFFF5FA2.toInt(), 0xFFFFB347.toInt())
        )
        val pad = Ui.dp(this, 28)
        root.setPadding(pad, Ui.dp(this, 90), pad, Ui.dp(this, 40))

        root.addView(Ui.center(Ui.text(this, item?.label ?: "鬧鐘", 20f)))
        clock = Ui.center(Ui.text(this, "", 96f, Ui.INK, true))
        root.addView(clock)

        val rest = Scheduler.upcoming(this).filter { it.millis <= System.currentTimeMillis() + 3 * 60 * 60 * 1000L }
        val hint = if (rest.isEmpty()) "這是這一輪最後一個鬧鐘" else "後面還有 ${rest.size} 個，下一個 ${rest[0].time}"
        root.addView(Ui.center(Ui.text(this, hint, 15f, 0xDDFFFFFF.toInt())))

        val spacer = LinearLayout(this)
        spacer.layoutParams = LinearLayout.LayoutParams(1, 0, 1f)
        root.addView(spacer)

        // 「我醒了」要先答對算術，避免半夢半醒按掉
        val a = Random.nextInt(12, 60)
        val b = Random.nextInt(12, 40)
        root.addView(Ui.center(Ui.text(this, "答對才算醒：$a + $b = ?", 17f)))
        val answer = EditText(this)
        answer.inputType = InputType.TYPE_CLASS_NUMBER
        answer.gravity = Gravity.CENTER
        answer.textSize = 26f
        answer.setTextColor(Ui.INK)
        answer.background = Ui.round(0x33000000, Ui.dp(this, 14).toFloat(), 0x55FFFFFF)
        val alp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 60))
        alp.topMargin = Ui.dp(this, 10)
        answer.layoutParams = alp
        root.addView(answer)

        root.addView(Ui.button(this, "我醒了（取消後面的鬧鐘）", true) {
            if (answer.text.toString().trim() == (a + b).toString()) {
                val n = Scheduler.markAwake(this)
                Api.log(this, "awake", item)
                stopService(Intent(this, AlarmService::class.java))
                Toast.makeText(this, "早安！已取消後面 $n 個鬧鐘", Toast.LENGTH_LONG).show()
                finish()
            } else {
                answer.setText("")
                Toast.makeText(this, "答錯了，再算一次", Toast.LENGTH_SHORT).show()
            }
        })
        root.addView(Ui.button(this, "只關掉這一個", false) {
            Api.log(this, "dismissed", item)
            stopService(Intent(this, AlarmService::class.java))
            finish()
        })
        setContentView(root)
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
