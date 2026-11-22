"""eeClass 收集器：登入後抓各科作業與公告，丟進待審核佇列。

eeClass 是台灣很多大學在用的教學平台，把 EECLASS_URL 換成你學校的網址即可
（例：https://ncueeclass.ncu.edu.tw）。

已用中央大學（ncueeclass.ncu.edu.tw）實際測過；其他學校的版面可能略有不同。
   第一次使用請先跑：  python -m app.sources.eeclass --debug
   它會把抓到的頁面存到 data/eeclass_debug/，解析結果印在畫面上，但不會寫進佇列。

帳密在網頁版「設定 → 進階 → 資料來源」填，每位成員各填自己的；第一位成員也可以寫在 .env：
EECLASS_URL / EECLASS_ACCOUNT / EECLASS_PASSWORD（帳密只存在這台電腦）。
"""
import html
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from . import conf

NAME = "eeclass"
LABEL = "eeClass 教學平台"
ENV = ["EECLASS_URL", "EECLASS_ACCOUNT", "EECLASS_PASSWORD"]

DEBUG_DIR = Path(__file__).resolve().parents[2] / "data" / "eeclass_debug"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Asa/1.0"}

TAG = re.compile(r"<[^>]+>")


def base() -> str:
    return conf.get("EECLASS_URL").rstrip("/")


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", fragment))).strip()


def login(client: httpx.Client, account: str, password: str) -> None:
    page = client.get(f"{base()}/index/login").text
    m = re.search(r"name=['\"]anticsrf['\"]\s+value=['\"]([^'\"]+)", page)
    data = {
        "_fmSubmit": "yes", "formVer": "3.0", "formId": "login_form",
        "next": "/dashboard", "act": "keep",
        "account": account, "password": password, "rememberMe": "",
        "anticsrf": m.group(1) if m else "",
    }
    client.post(f"{base()}/index/login", data=data, headers={"X-Requested-With": "XMLHttpRequest"})
    check = client.get(f"{base()}/dashboard", follow_redirects=False)
    if check.status_code != 200:
        raise RuntimeError("eeClass 登入失敗：請確認 .env 的帳號密碼（或登入流程已改版）")


def courses(client: httpx.Client) -> dict[str, str]:
    """回傳 {課程 id: 課名}。"""
    page = client.get(f"{base()}/dashboard").text
    _dump("dashboard", page)
    out: dict[str, str] = {}
    for cid, inner in re.findall(r"<a[^>]+href=['\"](?:https?://[^'\"]*)?/course/(\d+)['\"][^>]*>(.*?)</a>", page, re.S):
        name = re.sub(r"(?<=[一-鿿Ⅰ-ⅿ）)])\s+[A-Za-z][\w &,.:()'/-]*$", "", text_of(inner))   # 「軟體工程Ⅰ Software Engineering I」→ 只留中文
        if name and len(name) > len(out.get(cid, "")):
            out[cid] = name
    return out


def _rows(page: str) -> list[str]:
    return re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)


def _cells(row: str) -> list[str]:
    return re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)


def _col(rows: list[str], *names: str) -> dict[str, int]:
    """表頭（第一列）的欄名 → 位置。"""
    head = [text_of(c) for c in _cells(rows[0])] if rows else []
    return {n: head.index(n) for n in names if n in head}


def when(value: str, now: datetime | None = None) -> datetime | None:
    """「2026-11-10」「11-18 23:59」「2024-10-08」→ datetime；eeClass 只有今年的日期不寫年份。"""
    now = now or datetime.now()
    m = re.search(r"(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?", value)
    if not m:
        return None
    y, mo, d, h, mi = m.groups()
    hm = (int(h), int(mi)) if h else (23, 59)
    try:
        return datetime(int(y) if y else now.year, int(mo), int(d), *hm)
    except ValueError:
        return None


SERIES_DATE = re.compile(r"\d{1,2}\s*[/月]\s*\d{1,2}\s*日?|第\s*\d+\s*[週周次]|(?i:week)\s*\d+")
ONCE = re.compile(r"報告|簡報|(?i:presentation|slides?)")


def series_key(title: str) -> str:
    """「11/26 心得單繳交」「12/3 心得單繳交」→ 同一個系列「心得單繳交」。"""
    return re.sub(r"[\s_\-－:：]+", "", SERIES_DATE.sub("", title)).lower()


def homeworks(client: httpx.Client, cid: str, cname: str) -> list[dict]:
    """只收還沒交、還沒過期限、期限在半年內的作業（期限好幾年後的通常是常設的繳交區，不是作業）。

    每週重複的作業（標題只差日期，例如「11/26 心得單」「12/3 心得單」）只收最近要交的那一份，
    上一份過了期限，下一份才會進來。報告、簡報這類只要交過其中一週，整個系列就不再收。
    """
    page = client.get(f"{base()}/course/homeworkList/{cid}").text
    _dump(f"homework_{cid}", page)
    rows, now = _rows(page), datetime.now()
    col = _col(rows, "期限", "繳交", "Deadline", "Submitted")
    i_due, i_done = col.get("期限", col.get("Deadline")), col.get("繳交", col.get("Submitted"))
    found = []
    for row in rows:
        m = re.search(r"<a[^>]+href=['\"]([^'\"]*/course/homework/(\d+)[^'\"]*)['\"][^>]*>(.*?)</a>", row, re.S)
        if not m:
            continue
        cells = _cells(row)
        title = text_of(m.group(3))
        found.append({
            "id": m.group(2), "title": title, "href": m.group(1),
            "done": i_done is not None and i_done < len(cells) and "fa-check" in cells[i_done],
            "due": when(text_of(cells[i_due])) if i_due is not None and i_due < len(cells) else None,
            "series": series_key(title) if SERIES_DATE.search(title) else None,
        })
    groups: dict[str, list[dict]] = {}
    for h in found:
        if h["series"]:
            groups.setdefault(h["series"], []).append(h)
    keep = []
    for h in found:
        if h["done"] or (h["due"] and (h["due"] < now or h["due"] > now + timedelta(days=180))):
            continue                                       # 交了、過期限了，或是常設的繳交區
        g = groups.get(h["series"]) if h["series"] else None
        if g and len(g) > 1:
            if ONCE.search(h["title"]) and any(x["done"] for x in g):
                continue                                   # 報告／簡報：交過一週就好
            nxt = min((x for x in g if not x["done"] and x["due"] and x["due"] >= now), key=lambda x: x["due"], default=None)
            if nxt is not h:
                continue                                   # 每週的：只收下一份
        keep.append(h)
    return [{
        "ext_id": f"eeclass-hw-{h['id']}", "kind": "homework", "course": cname,
        "title": h["title"], "due": h["due"].strftime("%Y-%m-%dT%H:%M") if h["due"] else None,
        "link": h["href"] if h["href"].startswith("http") else base() + h["href"],
        "source": "eeclass",
    } for h in keep]


BULLETIN_DAYS = int(os.getenv("EECLASS_BULLETIN_DAYS", "14"))


def bulletins(client: httpx.Client, cid: str, cname: str) -> list[dict]:
    """只收最近 EECLASS_BULLETIN_DAYS 天（預設 14 天）的公告。"""
    page = client.get(f"{base()}/course/bulletin/{cid}").text
    _dump(f"bulletin_{cid}", page)
    rows, since = _rows(page), datetime.now() - timedelta(days=BULLETIN_DAYS)
    col = _col(rows, "公告日期", "Date")
    i_date = col.get("公告日期", col.get("Date"))
    out = []
    for row in rows:
        m = re.search(r"<a[^>]+(?:href|data-url)=['\"]([^'\"]*bulletin[^'\"]*?(\d+)[^'\"]*)['\"][^>]*>(.*?)</a>", row, re.S)
        if not m or not text_of(m.group(3)):
            continue
        cells = _cells(row)
        posted = when(text_of(cells[i_date])) if i_date is not None and i_date < len(cells) else None
        if posted and posted < since:
            continue
        out.append({
            "ext_id": f"eeclass-bu-{m.group(2)}", "kind": "announcement", "course": cname,
            "title": text_of(m.group(3)), "due": None,
            "link": f"{base()}/course/bulletin/{cid}", "source": "eeclass",   # 公告本身的網址帶一次性的驗證碼，改連到課程公告頁
        })
    return out


_debug = False


def _dump(name: str, page: str) -> None:
    if _debug:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        (DEBUG_DIR / f"{name}.html").write_text(page, encoding="utf-8")


def configured() -> bool:
    return bool(base() and conf.get("EECLASS_ACCOUNT") and conf.get("EECLASS_PASSWORD").strip())


def collect() -> list[dict]:
    """登入並抓回所有科目的作業與公告。"""
    with httpx.Client(headers=UA, follow_redirects=True, timeout=30) as client:
        login(client, conf.get("EECLASS_ACCOUNT"), conf.get("EECLASS_PASSWORD"))
        items: list[dict] = []
        for cid, cname in courses(client).items():
            for fn in (homeworks, bulletins):
                try:
                    items += fn(client, cid, cname)
                except Exception as e:  # noqa: BLE001  單一科目失敗不影響其他科
                    print(f"[eeclass] {cname} {fn.__name__} 失敗: {e}")
        return items


if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    _debug = "--debug" in sys.argv
    if not configured():
        sys.exit("請先在 .env 填入 EECLASS_URL、EECLASS_ACCOUNT 和 EECLASS_PASSWORD")
    found = collect()
    print(f"共抓到 {len(found)} 筆：")
    for it in found:
        print(f"  [{it['kind']}] {it['course']}｜{it['title']}｜{it['due'] or '-'}")
    if _debug:
        print(f"頁面已存到 {DEBUG_DIR}")
