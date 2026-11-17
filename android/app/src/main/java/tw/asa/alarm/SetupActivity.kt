package tw.asa.alarm

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

/** App 設定：連線、需要的權限、測試鬧鐘、手機上排好的鬧鐘。也接「asa://setup?url=…&token=…」自動設定。 */
class SetupActivity : Activity() {
    private lateinit var nextTime: TextView
    private lateinit var nextInfo: TextView
    private lateinit var list: TextView
    private lateinit var status: TextView
    private lateinit var perms: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Ui.BG
        window.navigationBarColor = Ui.BG

        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        val pad = Ui.dp(this, 20)
        root.setPadding(pad, Ui.dp(this, 28), pad, Ui.dp(this, 40))

        root.addView(Ui.text(this, tr("ASA · 權限與連線", "ASA · PERMISSIONS & CONNECTION"), 13f, Ui.MUTE, true).also { it.letterSpacing = 0.2f })
        root.addView(Ui.button(this, tr("← 回到 Asa", "← Back to Asa"), false) { openMain() })

        // 下一個鬧鐘
        val hero = Ui.card(this)
        hero.background = Ui.gradient(Ui.dp(this, 24).toFloat(), 0xFF2A1F6B.toInt(), 0xFF7C3AED.toInt(), 0xFFFF7A6B.toInt())
        hero.addView(Ui.text(this, tr("下一個鬧鐘", "Next alarm"), 14f, 0xDDFFFFFF.toInt()))
        nextTime = Ui.text(this, "--:--", 64f, Ui.INK, true)
        hero.addView(nextTime)
        nextInfo = Ui.text(this, "", 14f, 0xEEFFFFFF.toInt())
        hero.addView(nextInfo)
        root.addView(hero)

        val listCard = Ui.card(this)
        listCard.addView(Ui.text(this, tr("接下來", "Upcoming"), 13f, Ui.MUTE, true))
        list = Ui.text(this, "", 16f)
        list.setLineSpacing(Ui.dp(this, 6).toFloat(), 1f)
        list.setPadding(0, Ui.dp(this, 8), 0, 0)
        listCard.addView(list)
        status = Ui.text(this, "", 13f, Ui.MUTE)
        status.setPadding(0, Ui.dp(this, 12), 0, 0)
        listCard.addView(status)
        listCard.addView(Ui.button(this, tr("立即同步", "Sync now"), true) { syncNow() })
        root.addView(listCard)

        // 權限
        perms = Ui.card(this)
        root.addView(perms)

        // 伺服器設定
        val server = Ui.card(this)
        server.addView(Ui.text(this, tr("電腦上的 Asa", "Your Asa server"), 13f, Ui.MUTE, true))
        val url = field(tr("伺服器網址，例如 http://100.x.x.x:8787", "Server URL, e.g. http://100.x.x.x:8787"), Store.url(this), InputType.TYPE_TEXT_VARIATION_URI)
        val token = field(tr("存取碼（網頁「設定」→「把 Asa 裝到手機」）", "Access code (web Settings → Set up Asa on your phone)"), Store.token(this), InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
        server.addView(url)
        server.addView(token)
        server.addView(Ui.button(this, tr("儲存並同步", "Save and sync"), true) {
            var u = url.text.toString().trim()
            if (u.isNotEmpty() && !u.startsWith("http")) u = "http://$u"
            Store.saveServer(this, u, token.text.toString())
            syncNow(true)
        })
        root.addView(server)
        urlField = url
        tokenField = token

        val scroll = ScrollView(this)
        scroll.setBackgroundColor(Ui.BG)
        scroll.addView(root)
        setContentView(scroll)

        Scheduler.scheduleAll(this)
        Scheduler.scheduleSyncTick(this)
        if (!fromLink(intent) && Store.url(this).isNotEmpty()) syncNow()
    }

    private lateinit var urlField: EditText
    private lateinit var tokenField: EditText

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        fromLink(intent)
    }

    /** 從網頁的「打開 App 並自動設定」連過來：存好網址和存取碼，同步成功就回到主畫面。 */
    private fun fromLink(i: Intent?): Boolean {
        val d = i?.data ?: return false
        if (d.scheme != "asa" || d.host != "setup") return false
        val u = d.getQueryParameter("url").orEmpty().trim()
        val t = d.getQueryParameter("token").orEmpty().trim()
        if (u.isEmpty() || t.isEmpty()) return false
        Store.saveServer(this, u, t)
        urlField.setText(u)
        tokenField.setText(t)
        Toast.makeText(this, tr("已自動填好網址和存取碼", "Server and access code filled in"), Toast.LENGTH_SHORT).show()
        syncNow(true)
        return true
    }

    private fun openMain() {
        if (Store.url(this).isEmpty()) {
            Toast.makeText(this, tr("請先填伺服器網址和存取碼", "Enter the server URL and access code first"), Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("reload", true))
        finish()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun field(hint: String, value: String, type: Int): EditText {
        val e = EditText(this)
        e.hint = hint
        e.setText(value)
        e.setSingleLine()
        e.inputType = InputType.TYPE_CLASS_TEXT or type
        e.textSize = 15f
        e.setTextColor(Ui.INK)
        e.setHintTextColor(Ui.MUTE)
        e.background = Ui.round(0x0FFFFFFF, Ui.dp(this, 12).toFloat(), Ui.LINE)
        val p = Ui.dp(this, 14)
        e.setPadding(p, 0, p, 0)
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Ui.dp(this, 50))
        lp.topMargin = Ui.dp(this, 10)
        e.layoutParams = lp
        return e
    }

    /** thenOpen = 同步成功而且權限都開好，就直接回到主畫面。 */
    private fun syncNow(thenOpen: Boolean = false) {
        status.text = tr("同步中…", "Syncing…")
        thread {
            Scheduler.sync(applicationContext)
            runOnUiThread {
                refresh()
                if (thenOpen && Store.lastOk(this) && missing == 0) openMain()
            }
        }
    }

    private var missing = 0

    private fun refresh() {
        val up = Scheduler.upcoming(this)
        if (up.isEmpty()) {
            nextTime.text = "--:--"
            nextInfo.text = tr("目前沒有排定的鬧鐘", "No alarms scheduled")
            list.text = tr("（空）", "(none)")
        } else {
            nextTime.text = up[0].time
            val mins = ((up[0].millis - System.currentTimeMillis()) / 60000).toInt()
            nextInfo.text = tr("${up[0].date.substring(5)}　${mins / 60} 小時 ${mins % 60} 分鐘後　·　共 ${up.size} 個", "${up[0].date.substring(5)}  in ${mins / 60} h ${mins % 60} min  ·  ${up.size} total")
            list.text = up.take(24).joinToString("\n") { "${it.date.substring(5)}　${it.time}　${it.label}" }
        }
        status.text = Store.status(this)
        refreshPerms()
    }

    /** 列出還沒開的權限，每個給一顆按鈕；都開好就顯示完成。 */
    private fun refreshPerms() {
        perms.removeAllViews()
        perms.addView(Ui.text(this, tr("讓鬧鐘一定會響", "Make sure alarms always ring"), 13f, Ui.MUTE, true))
        missing = 0

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing++
            perms.addView(Ui.button(this, tr("允許通知", "Allow notifications"), false) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            })
        }
        val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
            missing++
            perms.addView(Ui.button(this, tr("允許設定精確鬧鐘", "Allow exact alarms"), false) {
                open(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            })
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 34 && !nm.canUseFullScreenIntent()) {
            missing++
            perms.addView(Ui.button(this, tr("允許在鎖定畫面全螢幕顯示", "Allow full-screen on the lock screen"), false) {
                open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
            })
        }
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(packageName)) {
            missing++
            perms.addView(Ui.button(this, tr("關閉電池最佳化（避免被系統休眠）", "Disable battery optimisation (so the system won't put it to sleep)"), false) {
                open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            })
        }
        if (missing == 0) {
            perms.addView(Ui.text(this, tr("✓ 需要的權限都開好了", "✓ All required permissions are granted"), 15f, 0xFF7CFF9B.toInt()).also {
                it.setPadding(0, Ui.dp(this, 8), 0, 0)
            })
        }
    }

    private fun open(intent: Intent) {
        try {
            startActivity(intent)
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            } catch (_: Exception) { }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshPerms()
    }
}
