package tw.asa.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

/** 鬧鐘時間到、定時同步、開機後重新排程，都從這裡進來。 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext
        if (intent.action == Scheduler.ACTION_FIRE) {
            if (intent.getBooleanExtra("check", false) && AlarmService.current != null) return   // 正在響別的鬧鐘：不用確認
            val service = Intent(app, AlarmService::class.java)
            intent.extras?.let { service.putExtras(it) }
            app.startForegroundService(service)
            return
        }
        if (intent.action == Scheduler.ACTION_NUDGE) {
            val pending = goAsync()
            thread {
                try {
                    val from = Scheduler.checkNudge(app)
                    if (from != null && AlarmService.current == null) {
                        val now = java.time.LocalDateTime.now()
                        app.startForegroundService(Intent(app, AlarmService::class.java)
                            .putExtra("date", now.toLocalDate().toString())
                            .putExtra("time", now.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")))
                            .putExtra("label", tr("📣 $from 在叫你起床！", "📣 $from is trying to wake you up!"))
                            .putExtra("loud", true))
                    }
                } finally {
                    Scheduler.nextNudgeTick(app)
                    pending.finish()
                }
            }
            return
        }
        // 開機、改時間、App 更新、定時同步：先用本機存的清單重排，再試著向電腦更新
        Scheduler.scheduleAll(app)
        val pending = goAsync()
        thread {
            try {
                Scheduler.sync(app)
            } finally {
                Scheduler.scheduleSyncTick(app)
                pending.finish()
            }
        }
    }
}
