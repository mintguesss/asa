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
            val service = Intent(app, AlarmService::class.java)
            intent.extras?.let { service.putExtras(it) }
            app.startForegroundService(service)
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
