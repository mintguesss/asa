"""eeClass 收集器：登入後抓各科作業與公告，丟進待審核佇列。

eeClass 是台灣很多大學在用的教學平台，把 EECLASS_URL 換成你學校的網址即可
（例：https://ncueeclass.ncu.edu.tw）。

⚠️ 這支程式是依登入頁結構和 eeClass 的常見網址規則寫的，還沒有用真實帳號驗證過。
   第一次使用請先跑：  python -m app.sources.eeclass --debug
   它會把抓到的頁面存到 data/eeclass_debug/，解析結果印在畫面上，但不會寫進佇列。

.env：EECLASS_URL / EECLASS_ACCOUNT / EECLASS_PASSWORD（帳密只存在這台電腦）。
"""
import html
import os
import re
import sys
from pathlib import Path

import httpx

NAME = "eeclass"
LABEL = "eeClass 教學平台"
ENV = ["EECLASS_URL", "EECLASS_ACCOUNT", "EECLASS_PASSWORD"]

DEBUG_DIR = Path(__file__).resolve().parents[2] / "data" / "eeclass_debug"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LifeHub/1.0"}

TAG = re.compile(r"<[^>]+>")
DATE = re.compile(r"(\d{4})[-/](\d{2})[-/](\d{2})(?:\s+(\d{2}):(\d{2}))?")


def base() -> str:
    return os.getenv("EECLASS_URL", "").strip().rstrip("/")


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
        name = text_of(inner)
        if name and len(name) > len(out.get(cid, "")):
            out[cid] = name
    return out


def _rows(page: str) -> list[str]:
    return re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S)


def homeworks(client: httpx.Client, cid: str, cname: str) -> list[dict]:
    page = client.get(f"{base()}/course/homeworkList/{cid}").text
    _dump(f"homework_{cid}", page)
    out = []
    for row in _rows(page):
        m = re.search(r"<a[^>]+href=['\"]([^'\"]*/course/homework/(\d+)[^'\"]*)['\"][^>]*>(.*?)</a>", row, re.S)
        if not m:
            continue
        dates = [f"{y}-{mo}-{d}T{h or '23'}:{mi or '59'}" for y, mo, d, h, mi in DATE.findall(text_of(row))]
        out.append({
            "ext_id": f"eeclass-hw-{m.group(2)}", "kind": "homework", "course": cname,
            "title": text_of(m.group(3)), "due": max(dates) if dates else None,
            "link": m.group(1) if m.group(1).startswith("http") else base() + m.group(1),
            "source": "eeclass",
        })
    return out


def bulletins(client: httpx.Client, cid: str, cname: str) -> list[dict]:
    page = client.get(f"{base()}/course/bulletin/{cid}").text
    _dump(f"bulletin_{cid}", page)
    out = []
    for row in _rows(page):
        m = re.search(r"<a[^>]+(?:href|data-url)=['\"]([^'\"]*bulletin[^'\"]*?(\d+)[^'\"]*)['\"][^>]*>(.*?)</a>", row, re.S)
        if not m or not text_of(m.group(3)):
            continue
        link = html.unescape(m.group(1))
        out.append({
            "ext_id": f"eeclass-bu-{m.group(2)}", "kind": "announcement", "course": cname,
            "title": text_of(m.group(3)), "due": None,
            "link": link if link.startswith("http") else base() + link, "source": "eeclass",
        })
    return out


_debug = False


def _dump(name: str, page: str) -> None:
    if _debug:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        (DEBUG_DIR / f"{name}.html").write_text(page, encoding="utf-8")


def configured() -> bool:
    return bool(base() and os.getenv("EECLASS_ACCOUNT", "").strip() and os.getenv("EECLASS_PASSWORD", "").strip())


def collect() -> list[dict]:
    """登入並抓回所有科目的作業與公告。"""
    with httpx.Client(headers=UA, follow_redirects=True, timeout=30) as client:
        login(client, os.environ["EECLASS_ACCOUNT"].strip(), os.environ["EECLASS_PASSWORD"])
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
