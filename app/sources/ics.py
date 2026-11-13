"""iCalendar（.ics）訂閱：Google 日曆、Outlook、Moodle、Canvas… 幾乎所有行事曆都能匯出這種網址。

.env：
    ICS_EVENT_URLS=工作=https://…/basic.ics,家庭=https://…      → 核准後變成「行程」
    ICS_DEADLINE_URLS=Moodle=https://…/export_execute.php?…      → 核准後變成「有截止時間的待辦」
    ICS_DAYS_AHEAD=60                                             → 只看未來幾天

限制：重複事件（RRULE）只會取第一次；帶 TZID 的時間視為本機時區。
"""
import hashlib
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

NAME = "ics"
LABEL = "iCalendar 訂閱（Google 日曆、Moodle、Canvas…）"
ENV = ["ICS_EVENT_URLS", "ICS_DEADLINE_URLS"]


def _feeds() -> list[tuple[str, str, str]]:
    """回傳 [(kind, 名稱, 網址)]。"""
    out = []
    for env, kind in (("ICS_EVENT_URLS", "event"), ("ICS_DEADLINE_URLS", "homework")):
        for part in os.getenv(env, "").split(","):
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
            cur.setdefault(key.split(";")[0].upper(), value)
    return events


def items_from(text: str, kind: str, feed: str, now: datetime, days_ahead: int) -> list[dict]:
    lo = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M")
    hi = (now + timedelta(days=days_ahead)).strftime("%Y-%m-%dT%H:%M")
    out = []
    for ev in parse(text):
        start = _when(ev.get("DTSTART", ""))
        title = _unescape(ev.get("SUMMARY", ""))
        if not start or not title or not (lo <= start[0] <= hi):
            continue
        end = _when(ev.get("DTEND", ""))
        when, allday = start
        if kind == "homework" and allday:
            when = when[:10] + "T23:59"         # 只給日期的截止，算當天最後一分鐘
        uid = ev.get("UID") or f"{title}{when}"
        out.append({
            "ext_id": "ics-" + hashlib.sha1(f"{feed}|{uid}|{when}".encode()).hexdigest()[:16],
            "kind": kind, "course": feed, "title": title, "due": when,
            "end": end[0] if end and not allday and kind == "event" else None,
            "location": _unescape(ev.get("LOCATION", "")),
            "link": ev.get("URL", "").strip(),
            "body": _unescape(ev.get("DESCRIPTION", ""))[:500],
            "source": NAME,
        })
    return out


def collect() -> list[dict]:
    now = datetime.now()
    days = int(os.getenv("ICS_DAYS_AHEAD", "60"))
    items: list[dict] = []
    with httpx.Client(follow_redirects=True, timeout=30, headers={"User-Agent": "Asa/1.0"}) as client:
        for kind, name, url in _feeds():
            r = client.get(url)
            r.raise_for_status()
            items += items_from(r.text, kind, name, now, days)
    return items
