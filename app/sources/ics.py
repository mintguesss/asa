"""iCalendar（.ics）訂閱：Google 日曆、Outlook、Moodle、Canvas… 幾乎所有行事曆都能匯出這種網址。

.env：
    ICS_EVENT_URLS=工作=https://…/basic.ics,家庭=https://…      → 核准後變成「行程」
    ICS_DEADLINE_URLS=Moodle=https://…/export_execute.php?…      → 核准後變成「有截止時間的待辦」
    ICS_DAYS_AHEAD=60                                             → 只看未來幾天
    ICS_REPEAT_DAYS_AHEAD=14                                      → 重複行程只展開未來幾天（避免審核佇列被洗版）

重複事件（RRULE）支援 DAILY / WEEKLY / MONTHLY / YEARLY，加上 INTERVAL、COUNT、UNTIL、BYDAY、BYMONTHDAY、
EXDATE，以及單次改期（RECURRENCE-ID）。其他較少見的規則（BYSETPOS、BYWEEKNO…）會被忽略。
帶 TZID 的時間視為本機時區。
"""
import calendar
import hashlib
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

from . import conf

NAME = "ics"
LABEL = "iCalendar 訂閱（Google 日曆、Moodle、Canvas…）"
ENV = ["ICS_EVENT_URLS", "ICS_DEADLINE_URLS"]


def _feeds() -> list[tuple[str, str, str]]:
    """回傳 [(kind, 名稱, 網址)]。"""
    out = []
    for env, kind in (("ICS_EVENT_URLS", "event"), ("ICS_DEADLINE_URLS", "homework")):
        for part in conf.get(env).split(","):
            part = part.strip()
            if not part:
                continue
            name, sep, url = part.partition("=")
            if not sep or not url.lstrip().lower().startswith(("http", "webcal")):
                name, url = "", part            # 沒寫名稱，整段就是網址
            out.append((kind, name.strip(), url.strip().replace("webcal://", "https://", 1)))
    return out


def configured() -> bool:
    return bool(_feeds())


def _unescape(s: str) -> str:
    return re.sub(r"\\([,;\\])", r"\1", s.replace("\\n", "\n").replace("\\N", "\n")).strip()


def _when(value: str) -> tuple[str, bool] | None:
    """把 ICS 時間轉成 ("YYYY-MM-DDTHH:MM", 是否整天)。"""
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?", value.strip())
    if not m:
        return None
    y, mo, d, h, mi, _, z = m.groups()
    if h is None:
        return f"{y}-{mo}-{d}T00:00", True
    dt = datetime(int(y), int(mo), int(d), int(h), int(mi))
    if z:
        dt = dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M"), False


def parse(text: str) -> list[dict]:
    """解析 ICS 文字，回傳每個 VEVENT 的欄位（已處理折行）。"""
    lines: list[str] = []
    for raw in text.splitlines():
        if raw[:1] in (" ", "\t") and lines:
            lines[-1] += raw[1:]
        else:
            lines.append(raw)
    events, cur = [], None
    for line in lines:
        if line.strip() == "BEGIN:VEVENT":
            cur = {}
        elif line.strip() == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            key, _, value = line.partition(":")
            name = key.split(";")[0].upper()
            if name == "EXDATE":                # 可以出現很多行
                cur["EXDATE"] = (cur["EXDATE"] + "," if "EXDATE" in cur else "") + value
            else:
                cur.setdefault(name, value)
    return events


_WD = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
FMT = "%Y-%m-%dT%H:%M"


def _nth_weekday(year: int, month: int, wd: int, n: int) -> int | None:
    """某月第 n 個星期 wd 是幾號（n 為負數時從月底算）。"""
    days = [d for d in range(1, calendar.monthrange(year, month)[1] + 1) if datetime(year, month, d).weekday() == wd]
    try:
        return days[n - 1] if n > 0 else days[n]
    except IndexError:
        return None


def occurrences(start: datetime, rrule: str, hi: datetime) -> list[datetime]:
    """展開 RRULE，回傳 start 到 hi 之間的每一次（含第一次）。"""
    rule = dict(p.split("=", 1) for p in rrule.upper().split(";") if "=" in p)
    freq = rule.get("FREQ")
    if freq not in ("DAILY", "WEEKLY", "MONTHLY", "YEARLY"):
        return [start]
    step = max(1, int(rule.get("INTERVAL", "1") or 1))
    count = int(rule["COUNT"]) if rule.get("COUNT", "").isdigit() else None
    if rule.get("UNTIL"):
        u = _when(rule["UNTIL"])
        if u:
            until = datetime.strptime(u[0], FMT) + (timedelta(days=1) if u[1] else timedelta())
            hi = min(hi, until)
    byday = []                                  # [(第幾個或 0, 星期)]
    for part in rule.get("BYDAY", "").split(","):
        m = re.fullmatch(r"([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)", part.strip())
        if m:
            byday.append((int(m.group(1) or 0), _WD[m.group(2)]))
    monthdays = [int(x) for x in rule.get("BYMONTHDAY", "").split(",") if x.strip().lstrip("+-").isdigit()]
    clock = {"hour": start.hour, "minute": start.minute}

    out: list[datetime] = []
    for k in range(20000):                      # 安全上限
        cands: list[datetime] = []
        if freq == "DAILY":
            d = start + timedelta(days=k * step)
            if not byday or d.weekday() in {w for _, w in byday}:
                cands = [d]
            period = d
        elif freq == "WEEKLY":
            week = start - timedelta(days=start.weekday()) + timedelta(weeks=k * step)
            cands = [week + timedelta(days=w) for w in sorted({w for _, w in byday} or {start.weekday()})]
            period = week
        elif freq == "MONTHLY":
            total = start.month - 1 + k * step
            y, mo = start.year + total // 12, total % 12 + 1
            last = calendar.monthrange(y, mo)[1]
            if monthdays:
                days = [d if d > 0 else last + 1 + d for d in monthdays]
            elif byday:
                days = [_nth_weekday(y, mo, w, n) for n, w in byday if n]
            else:
                days = [start.day]
            cands = [datetime(y, mo, d, **clock) for d in sorted({d for d in days if d and 1 <= d <= last})]
            period = datetime(y, mo, 1)
        else:
            y = start.year + k * step
            if start.day <= calendar.monthrange(y, start.month)[1]:
                cands = [datetime(y, start.month, start.day, **clock)]
            period = datetime(y, 1, 1)
        if period > hi:
            break
        for c in cands:
            if c < start:
                continue
            if c > hi or (count is not None and len(out) >= count):
                return out
            out.append(c)
    return out


def items_from(text: str, kind: str, feed: str, now: datetime, days_ahead: int,
               repeat_days: int | None = None) -> list[dict]:
    lo = (now - timedelta(days=1)).strftime(FMT)
    hi = (now + timedelta(days=days_ahead)).strftime(FMT)
    repeat_hi = now + timedelta(days=min(days_ahead, repeat_days if repeat_days is not None else days_ahead))
    events = parse(text)
    # 重複行程裡被單獨改期的那幾次：原本那一次不要再展開
    moved = {(ev.get("UID"), w[0]) for ev in events if ev.get("RECURRENCE-ID")
             for w in [_when(ev["RECURRENCE-ID"])] if w}
    out = []
    for ev in events:
        start = _when(ev.get("DTSTART", ""))
        title = _unescape(ev.get("SUMMARY", ""))
        if not start or not title:
            continue
        end = _when(ev.get("DTEND", ""))
        first, allday = start
        length = datetime.strptime(end[0], FMT) - datetime.strptime(first, FMT) if end else None
        whens = [first]
        if ev.get("RRULE") and not ev.get("RECURRENCE-ID"):
            skip = {w[0] for x in ev.get("EXDATE", "").split(",") for w in [_when(x)] if w}
            skip |= {w for uid, w in moved if uid == ev.get("UID")}
            whens = [w for w in (o.strftime(FMT) for o in occurrences(datetime.strptime(first, FMT), ev["RRULE"], repeat_hi))
                     if w not in skip]
        for when in whens:
            if not (lo <= when <= hi):
                continue
            stop = (datetime.strptime(when, FMT) + length).strftime(FMT) if length is not None else None
            if kind == "homework" and allday:
                when = when[:10] + "T23:59"     # 只給日期的截止，算當天最後一分鐘
            uid = ev.get("UID") or f"{title}{first}"
            out.append({
                "ext_id": "ics-" + hashlib.sha1(f"{feed}|{uid}|{when}".encode()).hexdigest()[:16],
                "kind": kind, "course": feed, "title": title, "due": when,
                "end": stop if stop and not allday and kind == "event" else None,
                "location": _unescape(ev.get("LOCATION", "")),
                "link": ev.get("URL", "").strip(),
                "body": _unescape(ev.get("DESCRIPTION", ""))[:500],
                "source": NAME,
            })
    return out


def collect() -> list[dict]:
    now = datetime.now()
    days = int(os.getenv("ICS_DAYS_AHEAD", "60"))
    repeat = int(os.getenv("ICS_REPEAT_DAYS_AHEAD", "14"))
    items: list[dict] = []
    with httpx.Client(follow_redirects=True, timeout=30, headers={"User-Agent": "Asa/1.0"}) as client:
        for kind, name, url in _feeds():
            r = client.get(url)
            r.raise_for_status()
            items += items_from(r.text, kind, name, now, days, repeat)
    return items
