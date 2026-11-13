package tw.lifehub.alarm

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** 介面都用程式碼畫，配色跟網頁版一致（深色＋極光漸層）。 */
object Ui {
    const val BG = 0xFF05060A.toInt()
    const val CARD = 0xFF0F1018.toInt()
    const val LINE = 0x22FFFFFF
    const val INK = 0xFFF3F4F8.toInt()
    const val MUTE = 0xFF7F8499.toInt()
    const val VIOLET = 0xFF7C5CFF.toInt()
    const val CYAN = 0xFF38E1FF.toInt()
    const val SUN = 0xFFFFA257.toInt()
    const val RED = 0xFFFF6B7D.toInt()

    fun dp(c: Context, v: Int): Int = (v * c.resources.displayMetrics.density + 0.5f).toInt()

    fun round(color: Int, radius: Float, stroke: Int = 0): GradientDrawable {
        val g = GradientDrawable()
        g.setColor(color)
        g.cornerRadius = radius
        if (stroke != 0) g.setStroke(2, stroke)
        return g
    }

    fun gradient(radius: Float, vararg colors: Int): GradientDrawable {
        val g = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, colors)
        g.cornerRadius = radius
        return g
    }

    fun text(c: Context, s: String, size: Float, color: Int = INK, bold: Boolean = false): TextView {
        val t = TextView(c)
        t.text = s
        t.textSize = size
        t.setTextColor(color)
        if (bold) t.typeface = Typeface.DEFAULT_BOLD
        return t
    }

    fun card(c: Context): LinearLayout {
        val l = LinearLayout(c)
        l.orientation = LinearLayout.VERTICAL
        l.background = round(CARD, dp(c, 20).toFloat(), LINE)
        val p = dp(c, 18)
        l.setPadding(p, p, p, p)
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.topMargin = dp(c, 14)
        l.layoutParams = lp
        return l
    }

    /** primary = 漸層主按鈕；否則是半透明次要按鈕 */
    fun button(c: Context, label: String, primary: Boolean, onClick: () -> Unit): Button {
        val b = Button(c)
        b.text = label
        b.isAllCaps = false
        b.textSize = 15f
        b.stateListAnimator = null
        b.typeface = if (primary) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        b.setTextColor(if (primary) Color.BLACK else INK)
        b.background = if (primary) gradient(dp(c, 14).toFloat(), VIOLET, CYAN)
        else round(0x14FFFFFF, dp(c, 14).toFloat(), LINE)
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(c, 52))
        lp.topMargin = dp(c, 10)
        b.layoutParams = lp
        b.setOnClickListener { onClick() }
        return b
    }

    fun space(c: Context, h: Int): View {
        val v = View(c)
        v.layoutParams = LinearLayout.LayoutParams(1, dp(c, h))
        return v
    }

    fun center(t: TextView): TextView {
        t.gravity = Gravity.CENTER
        t.layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        return t
    }
}
