package tw.asa.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator

/** 響鈴中的前景服務：聲音由小漸大、震動、鎖定畫面上跳出全螢幕。 */
class AlarmService : Service() {
    companion object {
        private const val CHANNEL = "alarm"
        private const val RING_LIMIT = 4 * 60 * 1000L   // 沒人理就 4 分鐘後自己停，等下一個鬧鐘
        @Volatile var current: AlarmItem? = null
        @Volatile var checking = false               // 起床確認：還沒大聲響，只是在問「還醒著嗎？」
        @Volatile var isTest = false
        private const val CHECK_WAIT = 60 * 1000L    // 起床確認 1 分鐘內沒按就大聲響
    }

    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var savedVolume = -1
    private var volume = 0.15f

    private val ramp = object : Runnable {
        override fun run() {
            volume = (volume + 0.06f).coerceAtMost(1f)
            try { player?.setVolume(volume, volume) } catch (_: Exception) { }
            if (volume < 1f) handler.postDelayed(this, 2000)
        }
    }
    private val timeout = Runnable { stopSelf() }
    private val escalate = Runnable {                // 起床確認沒人按：睡回去了，變成一般鬧鐘、一開始就大聲
        checking = false
        Store.addRing(this)
        startRinging(true)
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, RING_LIMIT)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val item = AlarmItem(
            intent?.getStringExtra("date") ?: "",
            intent?.getStringExtra("time") ?: "",
            intent?.getStringExtra("label") ?: tr("起床", "Wake up")
        )
        val check = intent?.getBooleanExtra("check", false) ?: false
        if (check && current != null) return START_NOT_STICKY      // 正在響別的鬧鐘：不用確認
        current = item
        val isTest = intent?.getBooleanExtra("test", false) ?: false
        AlarmService.isTest = isTest
        checking = check
        val loud = intent?.getBooleanExtra("loud", false) ?: false     // 被別人叫：一開始就大聲
        if (loud) volume = 1f

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(CHANNEL, tr("鬧鐘", "Alarm"), NotificationManager.IMPORTANCE_HIGH)
        channel.setSound(null, null)
        channel.enableVibration(false)
        channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        channel.setBypassDnd(true)
        nm.createNotificationChannel(channel)

        val open = Intent(this, AlarmActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val full = PendingIntent.getActivity(
            this, 3, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_bell)
            .setContentTitle(item.time + "  " + item.label)
            .setContentText(if (check) tr("還醒著嗎？點一下", "Still awake? Tap here") else tr("點一下關閉鬧鐘", "Tap to dismiss"))
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(full)
            .setFullScreenIntent(full, true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(1, notification)
        }

        if (check) {                                 // 起床確認：先輕輕震動，1 分鐘後才響
            holdWake()
            try {
                @Suppress("DEPRECATION")
                (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 1700), 0))
            } catch (_: Exception) { }
            handler.removeCallbacks(escalate)
            handler.postDelayed(escalate, CHECK_WAIT)
        } else if (player == null) startRinging(loud)
        handler.removeCallbacks(timeout)
        handler.postDelayed(timeout, RING_LIMIT)
        try { startActivity(open) } catch (_: Exception) { }   // 螢幕亮著時直接開；被系統擋下也有全螢幕通知
        if (!isTest && !loud && !check) {
            Store.addRing(this)                      // 今天第幾個：越晚題目越難
            Api.log(this, "fired", item)
            Scheduler.startNudgeWatch(this)
        }
        return START_NOT_STICKY
    }

    private fun holdWake() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "asa:alarm").apply { acquire(CHECK_WAIT + RING_LIMIT + 10_000L) }
    }

    private fun startRinging(loud: Boolean = false) {
        holdWake()
        if (loud) volume = 1f

        // 鬧鐘音量太小就先拉到六成，響完再調回去
        try {
            val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            val now = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            val floor = if (loud) max else (max * 0.6f).toInt()
            if (now < floor) {
                savedVolume = now
                audio.setStreamVolume(AudioManager.STREAM_ALARM, floor, 0)
            }
        } catch (_: Exception) { }

        try {
            val def = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val mine = Store.sound(this)
            val mp = MediaPlayer()
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(if (mine.isEmpty()) AudioAttributes.CONTENT_TYPE_SONIFICATION else AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            )
            try {                                   // 自己選的音樂（檔案被刪了就改回預設鈴聲）
                mp.setDataSource(this, if (mine.isEmpty()) def else android.net.Uri.parse(mine))
            } catch (_: Exception) {
                mp.reset()
                mp.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                mp.setDataSource(this, def)
            }
            mp.isLooping = true
            mp.setVolume(volume, volume)
            mp.prepare()
            mp.start()
            player = mp
            handler.postDelayed(ramp, 2000)
        } catch (_: Exception) { }

        try {
            @Suppress("DEPRECATION")
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 700, 500), 0))
        } catch (_: Exception) { }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try { player?.stop() } catch (_: Exception) { }
        try { player?.release() } catch (_: Exception) { }
        player = null
        try {
            @Suppress("DEPRECATION")
            (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
        } catch (_: Exception) { }
        if (savedVolume >= 0) {
            try {
                (getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                    .setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0)
            } catch (_: Exception) { }
        }
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { }
        current = null
        checking = false
        isTest = false
        super.onDestroy()
    }
}
