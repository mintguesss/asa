package tw.asa.alarm

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import org.json.JSONObject
import java.util.Locale
import kotlin.concurrent.thread

/** 朗讀：起床後唸早安簡報、網頁上按「唸給我聽」。用手機內建的文字轉語音。 */
object Voice {
    private var tts: TextToSpeech? = null
    private var ready = false
    private var pending: String? = null

    fun speak(c: Context, text: String) {
        val app = c.applicationContext
        if (tts == null) {
            pending = text
            tts = TextToSpeech(app) { status ->
                ready = status == TextToSpeech.SUCCESS
                if (!ready) {
                    tts = null
                    tell(app, tr("手機的文字轉語音沒有開：到「設定 → 協助工具 → 文字轉語音」選一個引擎（例如 Google）", "Text-to-speech is off: pick an engine in Settings → Accessibility → Text-to-speech"))
                }
                if (ready) {
                    val zh = Locale.getDefault().language == "zh"
                    val r = tts?.setLanguage(if (zh) Locale.TAIWAN else Locale.getDefault()) ?: TextToSpeech.LANG_NOT_SUPPORTED
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                        if (zh && (tts?.setLanguage(Locale.CHINESE) ?: -2) < 0)
                            tell(app, tr("文字轉語音沒有中文語音：到「設定 → 文字轉語音」下載中文", "No voice for this language: download one in Text-to-speech settings"))
                    }
                    tts?.setAudioAttributes(AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    pending?.let { say(it) }
                }
                pending = null
            }
        } else if (ready) say(text) else pending = text
    }

    private fun say(text: String) {
        // 一行一段，中間停一下比較好聽
        text.split("\n").map { it.trim() }.filter { it.isNotEmpty() }.forEachIndexed { i, line ->
            tts?.speak(line, if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, null, "asa$i")
        }
    }

    fun stop() { tts?.stop() }

    private fun tell(c: Context, msg: String) = android.os.Handler(android.os.Looper.getMainLooper()).post {
        android.widget.Toast.makeText(c, msg, android.widget.Toast.LENGTH_LONG).show()
    }

    /** 起床後：向電腦拿今天的簡報，唸出來。拿不到就算了。 */
    fun morningBrief(c: Context) {
        val app = c.applicationContext
        thread {
            try {
                val text = JSONObject(Api.get(app, "/api/brief?kind=morning")).getString("text")
                speak(app, plain(text))
            } catch (_: Exception) { }
        }
    }

    /** 拿掉表情符號，換掉唸起來怪的符號。 */
    fun plain(s: String): String = s
        .replace(Regex("[\\x{1F000}-\\x{1FFFF}\\x{2600}-\\x{27BF}\\x{2300}-\\x{23FF}\\x{FE0F}☐]"), "")
        .replace("｜", "，").replace("～", "到")
}
