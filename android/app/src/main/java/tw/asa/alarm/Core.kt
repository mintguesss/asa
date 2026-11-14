package tw.asa.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.concurrent.thread

/** 一個鬧鐘：date = YYYY-MM-DD，time = HH:MM */
data class AlarmItem(val date: String, val time: String, val label: String) {
    val key: String get() = date + "T" + time
    val millis: Long
        get() = LocalDateTime.parse(date + "T" + time + ":00")
            .atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
}

/** 本機儲存：伺服器設定、上次同步到的鬧鐘（電腦關機時照樣會響）。 */
object Store {
    private fun p(c: Context) = c.getSharedPreferences("asa", Context.MODE_PRIVATE)

    fun url(c: Context): String = (p(c).getString("url", "") ?: "").trim().trimEnd('/')
    fun token(c: Context): String = (p(c).getString("token", "") ?: "").trim()
    fun saveServer(c: Context, url: String, token: String) {
        p(c).edit().putString("url", url.trim()).putString("token", token.trim()).apply()
    }

    fun alarms(c: Context): List<AlarmItem> {
        val arr = JSONArray(p(c).getString("alarms", "[]") ?: "[]")
        val out = ArrayList<AlarmItem>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(AlarmItem(o.getString("date"), o.getString("time"), o.optString("label", tr("起床", "Wake up"))))
        }
        return out.sortedBy { it.millis }
    }

    fun setAlarms(c: Context, list: List<AlarmItem>) {
        val arr = JSONArray()
        for (a in list) arr.put(JSONObject().put("date", a.date).put("time", a.time).put("label", a.label))
        p(c).edit().putString("alarms", arr.toString()).apply()
    }

    fun status(c: Context): String = p(c).getString("status", tr("還沒同步過", "Never synced")) ?: ""
    fun setStatus(c: Context, s: String) { p(c).edit().putString("status", s).apply() }
    fun lastOk(c: Context): Boolean = p(c).getBoolean("lastOk", false)
    fun setLastOk(c: Context, ok: Boolean) { p(c).edit().putBoolean("lastOk", ok).apply() }

    /** 按下「我醒了」時取消掉的鬧鐘（date T time）。之後才新加的不在裡面，照樣會響。 */
    fun skipped(c: Context): Set<String> = p(c).getStringSet("skipped", emptySet()) ?: emptySet()
    fun setSkipped(c: Context, keys: Set<String>) { p(c).edit().putStringSet("skipped", HashSet(keys)).apply() }

    /** 起床時段：到這個時間點之前，每分鐘問電腦一次「有沒有人在叫我」。 */
    fun nudgeUntil(c: Context): Long = p(c).getLong("nudgeUntil", 0L)
    fun setNudgeUntil(c: Context, t: Long) { p(c).edit().putLong("nudgeUntil", t).apply() }
}

object Api {
    private fun open(c: Context, path: String): HttpURLConnection {
        val base = Store.url(c)
        if (base.isEmpty()) throw IllegalStateException(tr("尚未設定伺服器網址", "Server URL is not set"))
        val conn = URL(base + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        conn.setRequestProperty("X-Token", Store.token(c))
        return conn
    }

    fun get(c: Context, path: String): String {
        val conn = open(c, path)
        try {
            val code = conn.responseCode
            if (code != 200) throw IllegalStateException(if (code == 401) tr("存取碼錯誤", "Wrong access code") else tr("伺服器回應 $code", "Server responded $code"))
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    fun post(c: Context, path: String, body: JSONObject) {
        val conn = open(c, path)
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    /** 回報鬧鐘事件給電腦（fired / dismissed / awake），失敗就算了。 */
    fun log(c: Context, action: String, item: AlarmItem?) {
        val app = c.applicationContext
        val now = LocalDateTime.now()
        val body = JSONObject()
            .put("action", action)
            .put("date", item?.date ?: now.toLocalDate().toString())
            .put("ts", now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
        if (item != null) body.put("time", item.time)
        thread {
            try { post(app, "/api/phone/log", body) } catch (_: Exception) { }
        }
    }
}

object Scheduler {
    const val ACTION_FIRE = "tw.asa.alarm.FIRE"
    const val ACTION_SYNC = "tw.asa.alarm.SYNC"
    const val ACTION_NUDGE = "tw.asa.alarm.NUDGE"
    private const val NUDGE_EVERY = 60 * 1000L
    private const val SYNC_INTERVAL = 30 * 60 * 1000L
    private const val AWAKE_WINDOW = 3 * 60 * 60 * 1000L
    private const val FLAGS = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    private fun am(c: Context) = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun firePi(c: Context, item: AlarmItem): PendingIntent {
        val i = Intent(c, AlarmReceiver::class.java)
            .setAction(ACTION_FIRE)
            .setData(Uri.parse("asa://alarm/" + item.key))
            .putExtra("date", item.date).putExtra("time", item.time).putExtra("label", item.label)
        return PendingIntent.getBroadcast(c, 0, i, FLAGS)
    }

    private fun showPi(c: Context): PendingIntent =
        PendingIntent.getActivity(c, 1, Intent(c, MainActivity::class.java), FLAGS)

    /** 還沒響、也沒被「我醒了」取消的鬧鐘。 */
    fun upcoming(c: Context): List<AlarmItem> {
        val now = System.currentTimeMillis()
        val skip = Store.skipped(c)
        return Store.alarms(c).filter { it.millis > now && it.key !in skip }
    }

    private fun setExact(c: Context, at: Long, pi: PendingIntent) {
        try {
            am(c).setAlarmClock(AlarmManager.AlarmClockInfo(at, showPi(c)), pi)
        } catch (_: SecurityException) {
            am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    fun scheduleAll(c: Context) {
        for (item in upcoming(c)) setExact(c, item.millis, firePi(c, item))
    }

    fun cancel(c: Context, item: AlarmItem) = am(c).cancel(firePi(c, item))

    /** 向電腦抓最新的鬧鐘清單。要在背景執行緒呼叫。連不上就沿用上次的。 */
    fun sync(c: Context): String {
        val stamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("MM/dd HH:mm"))
        val msg = try {
            val js = JSONObject(Api.get(c, "/api/phone/alarms"))
            val arr = js.getJSONArray("alarms")
            // 電腦已經知道我醒了：它會把那幾個鬧鐘關掉，清單裡還有的就是後來新加或重新打開的
            if (js.optBoolean("awake")) Store.setSkipped(c, emptySet())
            val fresh = ArrayList<AlarmItem>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                fresh.add(AlarmItem(o.getString("date"), o.getString("time"), o.optString("label", tr("起床", "Wake up"))))
            }
            val keys = fresh.map { it.key }.toSet()
            for (old in Store.alarms(c)) if (old.key !in keys) cancel(c, old)
            Store.setAlarms(c, fresh)
            scheduleAll(c)
            Store.setLastOk(c, true)
            tr("已同步 $stamp，接下來有 ${upcoming(c).size} 個鬧鐘", "Synced $stamp, ${upcoming(c).size} alarms ahead")
        } catch (e: Exception) {
            scheduleAll(c)
            Store.setLastOk(c, false)
            tr("同步失敗 $stamp：${e.message ?: e.javaClass.simpleName}（沿用上次的鬧鐘）", "Sync failed $stamp: ${e.message ?: e.javaClass.simpleName} (keeping the last alarms)")
        }
        Store.setStatus(c, msg)
        return msg
    }

    /** 30 分鐘後再同步一次。 */
    fun scheduleSyncTick(c: Context) {
        val pi = PendingIntent.getBroadcast(c, 2, Intent(c, AlarmReceiver::class.java).setAction(ACTION_SYNC), FLAGS)
        am(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + SYNC_INTERVAL, pi)
    }

    /** 「我醒了」：取消接下來 3 小時內已經排好的鬧鐘，回傳取消了幾個。 */
    fun markAwake(c: Context): Int {
        val until = System.currentTimeMillis() + AWAKE_WINDOW
        val rest = upcoming(c).filter { it.millis <= until }
        for (item in rest) cancel(c, item)
        val today = java.time.LocalDate.now().toString()
        Store.setSkipped(c, Store.skipped(c).filter { it >= today }.toSet() + rest.map { it.key })
        stopNudgeWatch(c)
        return rest.size
    }

    private fun nudgePi(c: Context): PendingIntent =
        PendingIntent.getBroadcast(c, 4, Intent(c, AlarmReceiver::class.java).setAction(ACTION_NUDGE), FLAGS)

    /** 鬧鐘響了之後的 3 小時內，每分鐘問一次有沒有人在叫我起床（互相叫起床）。 */
    fun startNudgeWatch(c: Context) {
        Store.setNudgeUntil(c, System.currentTimeMillis() + AWAKE_WINDOW)
        nextNudgeTick(c)
    }

    fun nextNudgeTick(c: Context) {
        if (System.currentTimeMillis() > Store.nudgeUntil(c)) return
        am(c).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + NUDGE_EVERY, nudgePi(c))
    }

    fun stopNudgeWatch(c: Context) {
        Store.setNudgeUntil(c, 0L)
        am(c).cancel(nudgePi(c))
    }

    /** 問電腦一次。要在背景執行緒呼叫。回傳叫我的人的名字（沒有就 null）。 */
    fun checkNudge(c: Context): String? {
        return try {
            val js = JSONObject(Api.get(c, "/api/phone/nudge"))
            if (js.optBoolean("awake")) {         // 在網頁上按過「我醒了」：手機這邊也取消後面的鬧鐘
                markAwake(c)
                null
            } else js.optJSONObject("nudge")?.optString("from")
        } catch (_: Exception) { null }
    }

    /** 幾秒後響一個測試鬧鐘。 */
    fun testAlarm(c: Context, seconds: Int) {
        val now = LocalDateTime.now()
        val item = AlarmItem(now.toLocalDate().toString(), now.format(DateTimeFormatter.ofPattern("HH:mm")), tr("測試鬧鐘", "Test alarm"))
        val i = Intent(c, AlarmReceiver::class.java)
            .setAction(ACTION_FIRE)
            .setData(Uri.parse("asa://test"))
            .putExtra("date", item.date).putExtra("time", item.time).putExtra("label", item.label)
            .putExtra("test", true)
        setExact(c, System.currentTimeMillis() + seconds * 1000L, PendingIntent.getBroadcast(c, 0, i, FLAGS))
    }
}
