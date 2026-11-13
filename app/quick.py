"""快速輸入：把一句中文或英文解析成行程 / 待辦 / 鬧鐘 / 每週行程（純規則，不需要 AI）。

例：
  明天下午三點 跟教授 meeting @工程五館     → 行程
  週五前 交資料結構 HW3                      → 待辦（有截止）
  這週 整理房間                              → 本週待辦
  鬧鐘 明天 7:30                             → 手動鬧鐘
  每週二 9:10-12:00 微積分 @R203             → 固定行程

英文會先轉成對應的中文關鍵字再解析：
  tomorrow 3pm meeting @room 5 / report by fri / this week clean room / alarm tomorrow 7:30 / every tue 9:10-12:00 calculus
"""
import re
from datetime import date, timedelta

from .i18n import tr, wd as wd_name

WD_MAP = {c: i for i, c in enumerate("一二三四五六日")} | {"天": 6}
NUM = {"零": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _num(s: str) -> int:
    """'3'、'三'、'十二'、'二十' → int"""
    if s.isdigit():
        return int(s)
    if s == "十":
        return 10
    if s.startswith("十"):
        return 10 + NUM[s[1]]
    if s.endswith("十"):
        return NUM[s[0]] * 10
    if "十" in s:
        a, b = s.split("十")
        return NUM[a] * 10 + NUM[b]
    return NUM[s]


N = r"(\d{1,2}|[零一二兩三四五六七八九十]{1,3})"

EN_WD = {"mon": "一", "tue": "二", "wed": "三", "thu": "四", "fri": "五", "sat": "六", "sun": "日"}
EN_MON = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
_WD = r"(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?"
_MON = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"


def _english(t: str) -> str:
    """把英文的日期／時間／關鍵字換成中文解析器看得懂的寫法，其餘文字原樣保留。"""
    if not re.search(r"[A-Za-z]", t):
        return t
    I = re.I

    def ampm(m):
        h, mi, ap = int(m.group(1)), m.group(2) or "00", m.group(3).lower()
        h = h % 12 + (12 if ap == "pm" else 0)
        return f" {h:02d}:{mi} "

    t = re.sub(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", ampm, t, flags=I)
    t = re.sub(r"\bnoon\b", " 12:00 ", t, flags=I)
    t = re.sub(r"(\d{1,2}:\d{2})\s*(?:to|until|till)\s*(\d{1,2}:\d{2})", r"\1-\2", t, flags=I)
    t = re.sub(r"^\s*(alarm|wake me(?: up)?)\b(?:\s+(?:at|for))?", "鬧鐘 ", t, flags=I)
    t = re.sub(r"\bevery\s+" + _WD + r"\b", lambda m: f" 每週{EN_WD[m.group(1).lower()]} ", t, flags=I)
    t = re.sub(r"\bthis week\b", " 這週 ", t, flags=I)
    t = re.sub(r"\bday after tomorrow\b", " 後天 ", t, flags=I)
    t = re.sub(r"\b(tomorrow|tmrw?)\b", " 明天 ", t, flags=I)
    t = re.sub(r"\btonight\b", " 今晚 ", t, flags=I)
    t = re.sub(r"\btoday\b", " 今天 ", t, flags=I)
    t = re.sub(r"\bnext\s+" + _WD + r"\b", lambda m: f" 下週{EN_WD[m.group(1).lower()]} ", t, flags=I)
    t = re.sub(r"\b(?:on\s+)?" + _WD + r"\b", lambda m: f" 週{EN_WD[m.group(1).lower()]} ", t, flags=I)
    t = re.sub(r"\b" + _MON + r"\s+(\d{1,2})(?:st|nd|rd|th)?\b", lambda m: f" {EN_MON[m.group(1).lower()]}/{m.group(2)} ", t, flags=I)
    t = re.sub(r"\bin\s+(\d{1,2})\s+days?\b", r" \1天後 ", t, flags=I)
    t = re.sub(r"\b(?:due|by|before)\b\s*(?=(?:下|週|明天|後天|今天|今晚|\d))", " 截止 ", t, flags=I)
    t = re.sub(r"\b(?:at|on)\s+(?=\d{1,2}:\d{2}|\d{1,2}/\d)", " ", t, flags=I)
    return t


def _take(text: str, pattern: str):
    """找到就從字串挖掉，回傳 (match, 剩餘字串)。"""
    m = re.search(pattern, text)
    if not m:
        return None, text
    return m, (text[:m.start()] + " " + text[m.end():])


def parse(text: str, today: date | None = None) -> dict:
    today = today or date.today()
    raw = text.strip()
    t = _english(raw)
    out: dict = {"raw": raw}

    # 類型關鍵字
    is_alarm = False
    m, t = _take(t, r"^\s*(鬧鐘|叫我|叫醒我)")
    if m:
        is_alarm = True
    weekly_wd = None
    m, t = _take(t, r"每(?:週|周|星期|禮拜)([一二三四五六日天])")
    if m:
        weekly_wd = WD_MAP[m.group(1)]
    week_scope = False
    m, t = _take(t, r"(本週|這週|本周|這周|這禮拜|這星期)(?:內)?")
    if m:
        week_scope = True

    # 地點
    loc = ""
    m, t = _take(t, r"[@＠]\s*(\S+)")
    if m:
        loc = m.group(1)

    # 日期
    d = None
    for word, off in (("大後天", 3), ("後天", 2), ("明天", 1), ("明早", 1), ("明晚", 1), ("今天", 0), ("今晚", 0)):
        if word in t:
            d = today + timedelta(days=off)
            keep = "早上" if word == "明早" else "晚上" if word in ("明晚", "今晚") else ""
            t = t.replace(word, " " + keep + " ", 1)
            break
    if d is None:
        m, t = _take(t, r"(下下|下)?(?:週|周|星期|禮拜)([一二三四五六日天])")
        if m:
            wd = WD_MAP[m.group(2)]
            mon = today - timedelta(days=today.weekday())
            if m.group(1):
                d = mon + timedelta(days=wd + (14 if m.group(1) == "下下" else 7))
            else:
                d = mon + timedelta(days=wd)
                if d < today:
                    d += timedelta(days=7)
    if d is None:
        m, t = _take(t, r"(\d{1,2})\s*[/月]\s*(\d{1,2})\s*[日號]?")
        if m:
            mo, da = int(m.group(1)), int(m.group(2))
            try:
                d = date(today.year, mo, da)
                if d < today - timedelta(days=30):
                    d = date(today.year + 1, mo, da)
            except ValueError:
                d = None
    if d is None:
        m, t = _take(t, N + r"\s*天後")
        if m:
            d = today + timedelta(days=_num(m.group(1)))

    # 時間（可含結束時間）
    def clock(seg: str, period: str = ""):
        mm = re.match(r"(\d{1,2})[:：](\d{2})$", seg)
        if mm:
            h, mi = int(mm.group(1)), int(mm.group(2))
        else:
            mm = re.match(N + r"\s*[點时時](?:(半)|" + N + r"\s*分?)?$", seg)
            if not mm:
                return None
            h = _num(mm.group(1))
            mi = 30 if mm.group(2) else (_num(mm.group(3)) if mm.group(3) else 0)
        if period in ("下午", "晚上", "傍晚") and h < 12:
            h += 12
        if period == "中午" and h < 11:
            h += 12
        if period == "凌晨" and h == 12:
            h = 0
        return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else None

    T = r"(?:\d{1,2}[:：]\d{2}|" + N + r"\s*[點时時](?:半|" + N + r"\s*分?)?)"
    start = end = None
    m, t = _take(t, r"(上午|早上|中午|下午|晚上|傍晚|凌晨)?\s*(" + T + r")(?:\s*[-~～到至]\s*(" + T + r"))?")
    if m:
        period = m.group(1) or ""
        start = clock(m.group(2).strip(), period)
        g_end = next((g for g in m.groups()[2:] if g and re.search(r"[:：點时時]", g)), None)
        if g_end and start:
            end = clock(g_end.strip(), period)
            if end and end < start and int(end[:2]) < 12:
                end = f"{int(end[:2]) + 12:02d}{end[2:]}"
    else:
        m, t = _take(t, r"(早上|中午|下午|晚上)")   # 只講時段，不給時間

    # 截止語氣
    deadline = False
    m, t = _take(t, r"(之前|以前|前)(?=\s|$|交|要|完成)")
    if m:
        deadline = True
    if d and re.search(r"(截止|due|繳交|要交|交(?!通|流|換|往))", t, re.I):
        deadline = True

    if deadline:
        t = re.sub(r"(截止|due)", " ", t, flags=re.I)
    title = re.sub(r"\s+", " ", t).strip(" ，,。:：-")

    if is_alarm:
        if not start:
            return out | {"type": "error", "message": tr("鬧鐘需要時間，例如「鬧鐘 明天 7:30」")}
        dd = d or (today + timedelta(days=1))
        return out | {"type": "alarm", "date": dd.isoformat(), "time": start, "label": title}
    if weekly_wd is not None:
        if not start or not title:
            return out | {"type": "error", "message": tr("每週行程需要時間和名稱，例如「每週二 9:10-12:00 微積分」")}
        return out | {"type": "weekly", "weekday": weekly_wd, "start_time": start, "end_time": end,
                      "title": title, "location": loc}
    if not title:
        return out | {"type": "error", "message": tr("看不出要做什麼，請加上名稱")}
    if week_scope:
        return out | {"type": "task", "scope": "week", "title": title, "plan_date": today.isoformat()}
    if deadline:
        dd = d or today
        return out | {"type": "task", "scope": "day", "title": title, "plan_date": dd.isoformat(),
                      "due": f"{dd.isoformat()}T{start or '23:59'}"}
    if start:
        dd = d or today
        return out | {"type": "event", "title": title, "start": f"{dd.isoformat()}T{start}",
                      "end": f"{dd.isoformat()}T{end}" if end else None, "location": loc}
    return out | {"type": "task", "scope": "day", "title": title, "plan_date": (d or today).isoformat()}


def describe(p: dict) -> str:
    """給人看的解析結果，用「｜」分段。"""
    def day(iso: str) -> str:
        return tr("{date}（{wd}）", date=iso[5:10], wd=wd_name(date.fromisoformat(iso[:10]).weekday()))

    k = p.get("type")
    if k == "event":
        return tr("行程") + f"｜{day(p['start'])} {p['start'][11:]}" + (f"～{p['end'][11:]}" if p.get("end") else "") + \
               f"｜{p['title']}" + (f"｜{p['location']}" if p.get("location") else "")
    if k == "task":
        if p["scope"] == "week":
            return tr("本週待辦") + f"｜{p['title']}"
        due = "｜" + tr("截止 {due}", due=p["due"][5:].replace("T", " ")) if p.get("due") else ""
        return tr("待辦") + f"｜{day(p['plan_date'])}｜{p['title']}{due}"
    if k == "alarm":
        return tr("鬧鐘") + f"｜{p['date'][5:]} {p['time']}" + (f"｜{p['label']}" if p.get("label") else "")
    if k == "weekly":
        return tr("固定行程") + "｜" + tr("每週{wd}", wd=wd_name(p["weekday"])) + f" {p['start_time']}" + \
               (f"～{p['end_time']}" if p.get("end_time") else "") + f"｜{p['title']}" + (f"｜{p['location']}" if p.get("location") else "")
    return p.get("message") or tr("無法解析")
