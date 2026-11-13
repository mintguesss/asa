"""停班停課自動放假（台灣）。

.env：
    CLOSURE_AREA=桃園市          → 要看哪個縣市；留空就不啟用
    CLOSURE_MATCH=上課           → 看「停止上課」（學生）或改成 上班 看「停止上班」

資料來源是行政院人事行政總處的「天然災害停止上班及上課情形」頁面。只認整個縣市的公告
（例如「明天停止上班、停止上課」），只限某幾個區、里或學校的公告不會自動放假；
只有下午或晚上才停的也不算，因為早上還是要起床。

偵測到之後會把那天標成放假、重排鬧鐘並推播。萬一判斷錯了，到日曆把那天的放假取消就會恢復。
"""
import os
import re
from datetime import date, timedelta

import httpx

from . import core, db, notify
from .i18n import tr

URL = "https://www.dgpa.gov.tw/typh/daily/nds.html"


def area() -> str:
    return os.getenv("CLOSURE_AREA", "").strip()


def configured() -> bool:
    return bool(area())


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s).replace("臺", "台")


def rows(html: str) -> dict[str, str]:
    """解析公告表格，回傳 {縣市: 公告文字}（句子之間用換行分開）。"""
    out: dict[str, str] = {}
    for tr_ in re.findall(r"<tr\b.*?</tr>", html, flags=re.S | re.I):
        cells = re.findall(r"<td\b.*?</td>", tr_, flags=re.S | re.I)
        if len(cells) < 2:
            continue
        text = []
        for c in cells[:2]:
            c = re.sub(r"<br\s*/?>|</p>|</div>", "\n", c, flags=re.I)
            text.append(re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ").strip())
        if text[0] and len(text[0]) <= 12:
            out[_norm(text[0])] = text[1]
    return out


def closed(html: str, where: str, day_word: str, what: str = "上課") -> str | None:
    """where 那個縣市在 day_word（「今天」或「明天」）早上是否停班停課；是的話回傳那句公告。"""
    notice = rows(html).get(_norm(where))
    if not notice:
        return None
    for s in re.split(r"[。\n]", notice):
        s = _norm(s)
        if not s.startswith(day_word) or f"停止{what}" not in s:
            continue
        head = s[len(day_word):len(day_word) + 6]
        if re.match(r"(下午|晚上|晚間|中午|1[2-9]時|2\d時)", head):
            continue                            # 下午以後才停，早上照常
        return s
    return None


def check(offset: int) -> str | None:
    """offset=0 看今天、1 看明天。偵測到就標成放假並回傳公告文字。"""
    if not configured():
        return None
    r = httpx.get(URL, timeout=20, follow_redirects=True, headers={"User-Agent": "Asa/1.0"})
    r.raise_for_status()
    hit = closed(r.content.decode("utf-8", "replace"), area(), "明天" if offset else "今天",
                 os.getenv("CLOSURE_MATCH", "上課").strip() or "上課")
    d = (date.today() + timedelta(days=offset)).isoformat()
    db.kv_set("closure_last", f"{date.today().isoformat()} {area()}：{hit or '照常'}")
    if not hit or db.one("SELECT 1 FROM skip_dates WHERE date = ?", (d,)):
        return hit
    db.run("INSERT OR REPLACE INTO skip_dates (date, reason) VALUES (?, ?)", (d, tr("停班停課（自動偵測）")))
    core.regenerate_plan(d)
    notify.send(tr("🌀 {area} {notice}\n已把 {date} 標成放假並重排鬧鐘。如果判斷錯了，到日曆把這天的放假取消就會恢復。",
                   area=area(), notice=hit, date=d))
    return hit


def job(offset: int) -> None:
    try:
        check(offset)
    except Exception as e:  # noqa: BLE001  網站連不上就當作沒有公告，鬧鐘照常
        db.kv_set("closure_last", f"{date.today().isoformat()} 失敗：{e}")
