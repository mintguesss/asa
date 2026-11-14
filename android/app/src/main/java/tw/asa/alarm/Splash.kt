package tw.asa.alarm

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.DecelerateInterpolator

/**
 * 打開 App 的動畫：跟圖示同一個畫面——太陽從橫線後面升起來（約 0.6 秒）。
 * 網頁載入好之後整個淡出；網頁比較慢就停在升好的樣子等。
 */
class SunriseView(c: Context) : View(c) {
    private val bg = 0xFF11142C.toInt()
    private val bar = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFC266.toInt() }
    private val sun = Paint(Paint.ANTI_ALIAS_FLAG)
    private var t = 0f                  // 0 → 1：太陽升起的進度
    private var risen = false
    private var pendingHide: (() -> Unit)? = null

    init {
        setBackgroundColor(bg)
        ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 620
            startDelay = 80
            interpolator = DecelerateInterpolator(2f)
            addUpdateListener { t = it.animatedValue as Float; invalidate() }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                override fun onAnimationEnd(a: android.animation.Animator) { risen = true; pendingHide?.invoke(); pendingHide = null }
            })
            start()
        }
    }

    override fun onDraw(cv: Canvas) {
        // 比例照圖示（512 格）：半圓圓心 (256, 333)、半徑 128；橫線 y 345～370、x 102～410
        val s = minOf(width, height) * 0.42f / 512f
        val ox = width / 2f - 256 * s
        val oy = height / 2f - 300 * s
        val cx = ox + 256 * s
        val lineY = oy + 333 * s
        val r = 128 * s
        val cy = lineY + r * (1 - t) * 1.05f          // 從線下面升上來
        sun.shader = LinearGradient(cx - r, cy, cx + r, cy - r, intArrayOf(0xFF8B5CF6.toInt(), 0xFFFF7A8A.toInt(), 0xFFFFA77A.toInt()),
            null, Shader.TileMode.CLAMP)
        sun.alpha = (255 * minOf(1f, t * 2.5f)).toInt()
        cv.save()
        cv.clipRect(0f, 0f, width.toFloat(), lineY)    // 只畫線上面的部分
        cv.drawArc(RectF(cx - r, cy - r, cx + r, cy + r), 180f, 180f, true, sun)
        cv.restore()
        val w = (0.6f + 0.4f * t)                     // 橫線從中間展開
        val half = 154 * s * w
        bar.alpha = (255 * minOf(1f, t * 3f)).toInt()
        cv.drawRect(cx - half, oy + 345 * s, cx + half, oy + 370 * s, bar)
    }

    var hiding = false
        private set

    /** 網頁好了：等太陽升完，再慢慢放大、淡出（跟首頁的進場動畫同時進行）。onStart = 開始退場時呼叫。 */
    fun hide(onStart: () -> Unit = {}) {
        if (hiding) return
        val go = {
            if (!hiding) {
                hiding = true
                onStart()
                animate().alpha(0f).scaleX(1.06f).scaleY(1.06f).setDuration(420)
                    .setInterpolator(android.view.animation.AccelerateDecelerateInterpolator())
                    .withEndAction { visibility = GONE }.start()
            }
            Unit
        }
        if (risen) go() else pendingHide = go
    }
}
