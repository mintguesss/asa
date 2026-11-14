"""後端文字的中英文切換。

程式裡一律寫中文原文：tr("共 {n} 筆", n=3)。語言是英文時，從下面的 EN 查對應的翻譯。
- 網頁請求：依 X-Lang 標頭（前端的語言切換）。
- 排程推播：依 .env 的 ASA_LANG（zh 或 en，預設 zh）。
要加其他語言，再加一個字典、在 tr() 裡多查一層即可。
"""
import contextvars
import os

_lang: contextvars.ContextVar[str | None] = contextvars.ContextVar("lang", default=None)

WD_ZH = "一二三四五六日"
WD_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def default() -> str:
    return "en" if os.getenv("ASA_LANG", "zh").strip().lower().startswith("en") else "zh"


def set_lang(value: str | None) -> None:
    _lang.set(None if not value else "en" if value.lower().startswith("en") else "zh")


def lang() -> str:
    return _lang.get() or default()


def tr(zh: str, **kw) -> str:
    s = EN.get(zh, zh) if lang() == "en" else zh
    return s.format(**kw) if kw else s


def wd(i: int) -> str:
    """星期：中文回傳「一」，英文回傳「Mon」。"""
    return WD_EN[i] if lang() == "en" else WD_ZH[i]


def wd_full(i: int) -> str:
    return WD_EN[i] if lang() == "en" else "週" + WD_ZH[i]


EN = {
    # core：鬧鐘說明
    "這天沒有適用的鬧鐘規則": "No alarm rule applies to this day",
    "{time} {title}，提前 {lead} 分鐘開始": "{time} {title}, starting {lead} min before",
    "固定時間 {time}": "Fixed time {time}",
    "當天沒有行程，用備用時間 {time}": "Nothing scheduled, using fallback time {time}",
    "當天沒有行程，不排鬧鐘": "Nothing scheduled, no alarms",
    "【{rule}】{why}": "[{rule}] {why}",
    # core：每日簡報
    "🌙 明日預告": "🌙 Tomorrow",
    "☀️ 今日簡報": "☀️ Today",
    "{head}｜{date}（{wd}）": "{head} | {wd} {date}",
    "放假": "Day off",
    "⏰ 鬧鐘 {n} 個：{a}～{b}": "⏰ {n} alarms: {a}–{b}",
    "⏰ 明天沒有排鬧鐘": "⏰ No alarms tomorrow",
    "📅 行程：": "📅 Schedule: ",
    "無": "none",
    "📝 待辦：": "📝 To-do:",
    "（原訂 {d}）": " (planned {d})",
    "🗓 本週待辦：": "🗓 This week: ",
    "、": ", ",
    "⏳ 七天內截止：": "⏳ Due within 7 days:",
    "📥 有 {n} 則待審核": "📥 {n} item(s) waiting for review",
    # insights
    "資料還不夠（{n}/{need} 個早上），再累積幾天就會有建議。": "Not enough data yet ({n}/{need} mornings).",
    "最近 {n} 個早上，你通常在第一個鬧鐘後 {delay} 分鐘起床。": "Over the last {n} mornings you usually got up {delay} min after the first alarm. ",
    "有 {late} 次是最後一個鬧鐘響完才起來，建議多加 {add} 個並提早 {early} 分鐘開始。": "{late} time(s) you got up only after the last alarm; add {add} more and start {early} min earlier.",
    "多 {add} 個、提早 {early} 分鐘": "{add} more, start {early} min earlier",
    "有 {early} 次前兩個就起床了，可以減到 {n} 個。": "{early} time(s) you were up within the first two; {n} alarms are enough.",
    "減到 {n} 個": "Reduce to {n}",
    "前 {skip} 個幾乎叫不醒你，可以改成晚一點開始、間隔更密（每 {gap} 分鐘）。": "The first {skip} rarely wake you; start later and ring more often (every {gap} min).",
    "晚 {later} 分鐘開始、每 {gap} 分鐘一個": "Start {later} min later, every {gap} min",
    "目前的設定跟你的習慣相符，不用調整。": "Your current settings match your habits.",
    # quick
    "鬧鐘需要時間，例如「鬧鐘 明天 7:30」": "An alarm needs a time, e.g. \"alarm tomorrow 7:30\"",
    "每週行程需要時間和名稱，例如「每週二 9:10-12:00 微積分」": "A weekly event needs a time and a name, e.g. \"every tue 9:10-12:00 calculus\"",
    "看不出要做什麼，請加上名稱": "Please add a name",
    "無法解析": "Could not understand that",
    "行程": "Event", "待辦": "To-do", "本週待辦": "This week", "鬧鐘": "Alarm", "固定行程": "Weekly",
    "截止 {due}": "due {due}",
    "每週{wd}": "every {wd}",
    "{date}（{wd}）": "{wd} {date}",
    # main
    "沒有這個資料來源：{name}": "Unknown source: {name}",
    "尚未設定：請在 .env 填 {keys}": "Not configured: set {keys} in .env",
    "{now} 失敗：{err}": "{now} failed: {err}",
    "{now} 成功：共 {total} 筆，新增 {new} 筆待審核": "{now} ok: {total} item(s), {new} new for review",
    "📥 {label} 有 {n} 則新項目待審核": "📥 {label}: {n} new item(s) to review",
    "📥 待審核：[{tag}] {title}": "📥 To review: [{tag}] {title}",
    "⏰ 截止 {due}": "⏰ Due {due}",
    "找不到待審核項目": "No such pending item",
    "需要存取碼：請在網址後面加上 ?token=你的存取碼": "Access code required: add ?token=YOUR_CODE to the URL",
    "起床": "Wake up",
    "我": "Me",
    "這位成員沒有開鬧鐘": "Alarms are off for this member",
    "沒有這位成員": "No such member",
    "這一筆不是共用的": "This item is not shared",
    "⏰ 起床！（第 {i}／{n} 個）": "⏰ Wake up! ({i} of {n})",
    "\n{time} {title}": "\n{time} {title}",
    "🔔 {n} 分鐘後：{time} {title}": "🔔 In {n} min: {time} {title}",
    "只有第一位成員或這台電腦可以管理成員": "Only the first member, or a browser on the server itself, can manage members",
    "只能改自己的設定": "You can only change your own settings",
    "設定值不正確": "Invalid value",
    "圖片格式不支援或太大": "Unsupported or too large image",
    "找不到這個行程": "Event not found", "留言是空的": "Empty comment", "只能刪自己的留言": "You can only delete your own comments",
    "💬 {who} 在「{title}」留言：{body}": "💬 {who} commented on \u201c{title}\u201d: {body}",
    "📅 {who} 新增了一起的行程：{title}": "📅 {who} added a shared event: {title}",
    "第一位成員不能移除": "The first member cannot be removed",
    "其他裝置要用那位成員自己的存取碼": "Other devices must use that member's own access code",
    "停班停課（自動偵測）": "Closure (detected automatically)",
    "🌀 {area} {notice}\n已把 {date} 標成放假並重排鬧鐘。如果判斷錯了，到日曆把這天的放假取消就會恢復。":
        "🌀 {area}: {notice}\n{date} is now marked as a day off and the alarms were re-planned. If this is wrong, remove the day off in the calendar.",
    "👉 審核：{url}": "👉 Review: {url}",
    "{now} 成功：共 {total} 筆，自動加入 {new} 筆": "{now} OK: {total} items, {new} added automatically",
    "✅ {label} 自動加入 {n} 則新項目": "✅ {label}: {n} new items added automatically",
    "✅ Asa 通知測試成功": "✅ Asa notification test OK",
    "平日": "Weekdays", "週末": "Weekend",
    "剛剛叫過了，等一分鐘再叫": "You just did — wait a minute", "{name} 已經起床了": "{name} is already up",
    "📣 {who} 在叫你起床！": "📣 {who} is trying to wake you up!",
    "😴 {name} 還沒起床：最後一個鬧鐘 {last} 已經過了 {n} 分鐘。": "😴 {name} is still asleep: the last alarm was at {last}, {n} min ago.",
    "👉 打開 Asa 叫他起床：{url}": "👉 Open Asa to wake them: {url}",
    "\n醒了就點：{url}": "\nTap when you're up: {url}",
    "{time} {title}：準備 {lead} 分鐘＋{go}": "{time} {title}: {lead} min to get ready + {go}",
    "晴": "Sunny", "晴時多雲": "Mostly sunny", "多雲": "Partly cloudy", "陰": "Overcast", "有霧": "Foggy",
    "毛毛雨": "Drizzle", "有雨": "Rain", "大雨": "Heavy rain", "凍雨": "Freezing rain", "下雪": "Snow", "雷雨": "Thunderstorms",
    "{icon} {where}：{text}，{lo}～{hi}°C": "{icon} {where}: {text}, {lo}–{hi}°C", "（現在 {t}°C）": " (now {t}°C)",
    "，降雨機率 {p}%": ", {p}% chance of rain", "，記得帶傘 ☂️": ", take an umbrella ☂️",
    "地圖上找不到這個地方，換個寫法試試（例如「桃園市中壢區」）": "Couldn't find that place on the map. Try another spelling (e.g. a city name)",
    "查不到座標：連不上地圖服務，等一下再試": "Couldn't reach the map service. Try again later",
    "預設": "default", "先填家的地址": "Set your home address first",
    "估不出來：地圖上找不到這個地點，請自己填分鐘數": "Couldn't estimate: the place wasn't found on the map. Enter the minutes yourself.",
    "🌧 {why}\n⏰ 鬧鐘提早到 {t}（原本 {b}）": "🌧 {why}\n⏰ Alarm moved earlier to {t} (was {b})",
    # 來源與通知的顯示名稱
    "eeClass 教學平台": "eeClass LMS",
    "iCalendar 訂閱（Google 日曆、Moodle、Canvas…）": "iCalendar feeds (Google Calendar, Moodle, Canvas…)",
    "自訂 Webhook": "Custom webhook",
}
