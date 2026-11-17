"""Asa 主程式：API + 排程 + 網頁介面。"""
import base64
import binascii
import contextvars
import os
import secrets
import shutil
import socket
import subprocess
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import closures, core, db, demo, i18n, insights, notify, profiles, quick, social, sources, wake, weather
from .i18n import tr

ROOT = Path(__file__).resolve().parent
ENV = ROOT.parent / ".env"
load_dotenv(ENV)
if not os.getenv("PHONE_TOKEN", "").strip():
    # 第一次啟動：自動產生手機用的存取碼並寫進 .env
    _tok = "-".join(secrets.token_hex(2) for _ in range(3))
    with ENV.open("a", encoding="utf-8") as _f:
        _f.write(f"\nPHONE_TOKEN={_tok}\n")
    os.environ["PHONE_TOKEN"] = _tok

DEMO = os.getenv("ASA_DEMO", "").strip().lower() not in ("", "0", "false", "no")
if DEMO:
    # 示範模式：用獨立的資料庫，每次啟動重建（見 demo.py）
    db.DB_PATH = db.DB_PATH.with_name("demo.db")
    for _old in db.DB_PATH.parent.glob("demo*.db*"):
        _old.unlink(missing_ok=True)
    shutil.rmtree(db.DB_PATH.parent / "demo-avatars", ignore_errors=True)
    weather.OFFLINE = True


def today() -> str:
    return date.today().isoformat()


def tomorrow() -> str:
    return (date.today() + timedelta(days=1)).isoformat()


def pick(body: dict, fields: list[str]) -> dict:
    return {k: body[k] for k in fields if k in body}


def refresh_tomorrow() -> None:
    """行程或規則有變動時，重排明天的自動鬧鐘（「一起的」行程會影響其他成員，所以每個人都重排）。"""
    for _ in profiles.each():
        core.regenerate_plan(tomorrow())


LOCAL: contextvars.ContextVar[bool] = contextvars.ContextVar("asa_local", default=True)


def is_admin() -> bool:
    """能不能管理成員：這台電腦上的瀏覽器，或第一位成員。"""
    return LOCAL.get() or db.me() == 1


def flag(v) -> int:
    return 1 if v in (1, True, "1", "on", "true") else 0


@contextmanager
def owned(owner: int | None, table: str, id_: int):
    """要改的那一筆如果是別的成員的，切到他的資料庫；但只有標成共用的才准動。"""
    if not owner or int(owner) == db.me():
        yield
        return
    if not profiles.get(owner):
        raise HTTPException(404, tr("沒有這位成員"))
    with db.as_profile(owner):
        if not db.one(f"SELECT 1 FROM {table} WHERE id = ? AND shared = 1", (id_,)):
            raise HTTPException(403, tr("這一筆不是共用的"))
        yield


# ---------- 排程工作 ----------
def each_profile():
    """排程工作用：依序切到每位成員，並用他的語言。"""
    for p in profiles.each():
        i18n.set_lang(p["lang"])
        yield p
    i18n.set_lang(None)


def job_evening() -> None:
    d = tomorrow()
    for _ in each_profile():
        core.regenerate_plan(d)
        notify.send(core.brief_text(d, "evening"))


def job_morning() -> None:
    for _ in each_profile():
        notify.send(core.brief_text(today(), "morning"))


def job_minute() -> None:
    """每分鐘：行程開始前的提醒；起床方式選「推播」的成員，到點用推播叫。"""
    now = datetime.now()
    hm_now = now.strftime("%H:%M")
    for p in each_profile():
        if p["alarm_mode"] == "notify":
            on = [a for a in core.plan(today()) if a["enabled"]]
            for i, a in enumerate(on):
                if a["time"] == hm_now:
                    nxt = next((e for e in core.events_on(today()) if e["wake"] and e["time"] > hm_now), None)
                    link = server_urls()[:1]
                    notify.send(tr("⏰ 起床！（第 {i}／{n} 個）", i=i + 1, n=len(on))
                                + (tr("\n{time} {title}", time=nxt["time"], title=nxt["title"]) if nxt else "")
                                + (tr("\n醒了就點：{url}", url=link[0] + "/?awake=1") if link else ""), urgent=i == len(on) - 1)
        if p["remind_minutes"]:
            later = now + timedelta(minutes=p["remind_minutes"])
            if later.date() == now.date():
                for e in core.events_on(today()):
                    if e["time"] == later.strftime("%H:%M") and not e["title"].startswith("⏰"):
                        loc = f"（{e['location']}）" if e.get("location") else ""
                        notify.send(tr("🔔 {n} 分鐘後：{time} {title}", n=p["remind_minutes"], time=e["time"],
                                       title=e["title"]) + loc)


def job_wake() -> None:
    urls = server_urls()
    wake.job(urls[0] + "/?view=day" if urls else "")


def inbox_add(data: dict, silent: bool = False) -> int | None:
    """放進待審核佇列；ext_id 重複就略過。回傳新 id 或 None。"""
    if data.get("ext_id") and db.one("SELECT 1 FROM inbox WHERE ext_id = ?", (data["ext_id"],)):
        return None
    id_ = db.insert("inbox", data)
    if not silent:
        due = "\n" + tr("⏰ 截止 {due}", due=data["due"].replace("T", " ")) if data.get("due") else ""
        notify.send(tr("📥 待審核：[{tag}] {title}", tag=data.get("course") or data["kind"], title=data["title"])
                    + f"{due}\n{data.get('link', '')}".rstrip() + "\n" + review_link())
    return id_


def review_link() -> str:
    """審核頁的網址，附在推播裡，點了就能核准。"""
    urls = server_urls()
    return tr("👉 審核：{url}", url=urls[0] + "/?view=inbox") if urls else ""


def auto_approve(name: str) -> bool:
    """.env 的 AUTO_APPROVE=ics,eeclass：這些來源的新項目不用審核，直接加進行事曆／待辦。"""
    return name in {x.strip().lower() for x in os.getenv("AUTO_APPROVE", "").split(",")}


def job_source(name: str) -> dict:
    """執行一個資料來源。已過期的項目只記錄不進佇列；第一次執行時沒有日期的舊項目也一樣，避免洗版。"""
    mod = sources.BY_NAME.get(name)
    if not mod:
        return {"ok": False, "message": tr("沒有這個資料來源：{name}", name=name)}
    if not mod.configured():
        return {"ok": False, "message": tr("尚未設定：請在 .env 填 {keys}", keys=", ".join(mod.ENV))}
    now = datetime.now().isoformat(timespec="minutes")
    try:
        items = mod.collect()
    except Exception as e:  # noqa: BLE001
        db.kv_set(f"src_{name}_last", tr("{now} 失敗：{err}", now=now, err=e))
        return {"ok": False, "message": str(e)}
    first = db.kv_get(f"src_{name}_seeded") is None
    auto = auto_approve(name)
    new = []
    for it in items:
        old = (it.get("due") and it["due"] < now) or (first and not it.get("due"))
        id_ = inbox_add(pick(it, INBOX_F), silent=True)
        if id_ and old:
            db.update("inbox", id_, {"status": "rejected"})
        elif id_ and auto and it.get("kind") != "announcement":
            approve_inbox(id_, {})
            new.append(it)
        elif id_:
            new.append(it)
    db.kv_set(f"src_{name}_seeded", "1")
    db.kv_set(f"src_{name}_last", tr("{now} 成功：共 {total} 筆，新增 {new} 筆待審核", now=now, total=len(items), new=len(new))
              if not auto else tr("{now} 成功：共 {total} 筆，自動加入 {new} 筆", now=now, total=len(items), new=len(new)))
    if new:
        lines = [tr("📥 {label} 有 {n} 則新項目待審核", label=tr(mod.LABEL), n=len(new)) if not auto
                 else tr("✅ {label} 自動加入 {n} 則新項目", label=tr(mod.LABEL), n=len(new))]
        lines += [f"  {'[' + i['course'] + '] ' if i.get('course') else ''}{i['title']}"
                  + (f"（{i['due'][5:].replace('T', ' ')}）" if i.get("due") else "") for i in new[:10]]
        if not auto:
            lines.append(review_link())
        notify.send("\n".join(lines).rstrip())
    return {"ok": True, "total": len(items), "new": len(new)}


def job_sources() -> None:
    for mod in sources.ALL:
        if mod.configured():
            job_source(mod.NAME)


def hm(env: str, default: str) -> tuple[int, int]:
    h, m = os.getenv(env, default).split(":")
    return int(h), int(m)


def default_rules() -> None:
    """目前這位成員還沒有任何鬧鐘規則的話，給兩條預設的。"""
    if not db.rows("SELECT 1 FROM alarm_rules LIMIT 1"):
        db.insert("alarm_rules", {"name": tr("平日"), "weekdays": "0,1,2,3,4", "anchor": "first_event",
                                  "lead_minutes": 90, "count": 8, "interval_minutes": 5})
        db.insert("alarm_rules", {"name": tr("週末"), "weekdays": "5,6", "anchor": "first_event",
                                  "lead_minutes": 90, "count": 4, "interval_minutes": 10})


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    profiles.ensure(tr("我"))
    default_rules()
    if DEMO:
        demo.seed()
        yield
        return
    if not core.plan(tomorrow()):
        core.regenerate_plan(tomorrow())
    sched = BackgroundScheduler()
    eh, em = hm("EVENING_TIME", "21:30")
    mh, mm = hm("MORNING_TIME", "08:00")
    sched.add_job(job_evening, "cron", hour=eh, minute=em)
    sched.add_job(job_morning, "cron", hour=mh, minute=mm)
    sched.add_job(job_minute, "cron", second=0)
    sched.add_job(job_wake, "cron", second=20)
    if closures.configured():
        # 停班停課：前一晚 19–22 點陸續公告，也可能凌晨才宣布，所以晚上和清晨各查幾次
        sched.add_job(closures.job, "cron", hour="19-23", minute="5,35", args=[1])
        sched.add_job(closures.job, "cron", hour="0-7", minute="10,40", args=[0])
    if any(m.configured() for m in sources.ALL):
        sched.add_job(job_sources, "interval", minutes=int(os.getenv("SYNC_INTERVAL_MINUTES", "30")),
                      next_run_time=datetime.now() + timedelta(seconds=20))
    sched.start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="Asa", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.middleware("http")
async def fresh_static(request: Request, call_next):
    """網頁檔案每次都跟伺服器確認有沒有更新，升級後不會卡在瀏覽器的舊版。"""
    resp = await call_next(request)
    if not request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.middleware("http")
async def guard(request: Request, call_next):
    """本機直接放行；其他裝置（手機）要帶存取碼。存取碼同時決定「你是哪位成員」。"""
    host = request.client.host if request.client else ""
    i18n.set_lang(request.headers.get("x-lang"))
    proxied = any(h in request.headers for h in ("x-forwarded-for", "forwarded", "tailscale-user-login"))
    if host in ("127.0.0.1", "::1", "testclient") and not proxied:   # 經過反向代理（Tailscale Serve 等）來的不算本機
        # 這台電腦上：預設是第一位成員，設定頁可以切換（記在 cookie）
        pick_ = request.headers.get("x-profile") or request.cookies.get("asa_profile") or "1"
        LOCAL.set(True)
        db.use(int(pick_) if pick_.isdigit() and profiles.get(int(pick_)) else 1)
        return await call_next(request)
    if request.url.path in PUBLIC:
        return await call_next(request)
    given = (request.headers.get("x-token") or request.query_params.get("token")
             or request.cookies.get("lh_token") or "")
    who = profiles.by_token(given)
    if not who:
        if request.method == "GET" and not request.url.path.startswith("/api/"):
            # 瀏覽器（包括裝成 App 之後）沒有存取碼：給一個輸入頁，不要只丟一行字
            return FileResponse(ROOT / "static" / "login.html", status_code=401, headers={"Cache-Control": "no-store"})
        return PlainTextResponse(tr("需要存取碼：請在網址後面加上 ?token=你的存取碼"), status_code=401)
    LOCAL.set(False)
    db.use(who["id"])
    resp = await call_next(request)
    if request.query_params.get("token"):
        resp.set_cookie("lh_token", given, max_age=31536000, httponly=True, samesite="lax")
    return resp


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


# 裝成 App（PWA）要的檔案。這些不含任何個人資料，不用存取碼也能拿（瀏覽器抓 manifest 時不會帶 cookie）。
PUBLIC = {"/manifest.webmanifest", "/sw.js", "/static/icons/icon-192.png", "/static/icons/icon-512.png",
          "/static/icons/maskable-512.png", "/static/icons/apple-touch-icon.png"}


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(ROOT / "static" / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(ROOT / "static" / "sw.js", media_type="text/javascript",
                        headers={"Service-Worker-Allowed": "/"})


# ---------- 總覽 ----------
def cal_view(s: dict) -> dict:
    """日曆畫面不放固定行程（固定行程頁另外看），鬧鐘、簡報照樣會算進去。"""
    return s | {"events": [e for e in s["events"] if e.get("source") != "weekly"]}


@app.get("/api/day")
def api_day(d: str | None = None):
    return cal_view(core.day_summary(d or today()))


@app.get("/api/week")
def api_week(d: str | None = None):
    mon = date.fromisoformat(core.week_monday(d or today()))
    return [cal_view(core.day_summary((mon + timedelta(days=i)).isoformat())) for i in range(7)]


@app.get("/api/month")
def api_month(d: str | None = None):
    """月曆：從當月 1 號所在那週的週一開始，固定 6 週 42 格。"""
    first = date.fromisoformat(d or today()).replace(day=1)
    start = first - timedelta(days=first.weekday())
    out = []
    for i in range(42):
        day = (start + timedelta(days=i)).isoformat()
        evs = core.events_on(day)
        on = [a["time"] for a in core.plan(day) if a["enabled"]]
        out.append({
            "date": day, "in_month": day[:7] == first.isoformat()[:7],
            "skip": bool(db.one("SELECT 1 FROM skip_dates WHERE date = ?", (day,))),
            "events": [{"time": e["time"], "title": e["title"],
                        "kind": "weekly" if e.get("source") == "weekly" else "shared" if e.get("shared") or e.get("owner") else "mine",
                        "color": (profiles.get(e["owner"]) or {}).get("color") if e.get("owner") else None}
                       for e in evs if not e["title"].startswith("⏰") and e.get("source") != "weekly"],
            "due": [t["title"] for t in db.rows("SELECT title FROM tasks WHERE done=0 AND substr(due,1,10)=?", (day,))],
            "tasks": db.one("SELECT COUNT(*) n FROM tasks WHERE done=0 AND scope='day' AND plan_date=?", (day,))["n"],
            "alarm": on[0] if on else None, "alarms": len(on),
        })
    return {"month": first.isoformat()[:7], "days": out}


# ---------- 行程 ----------
EVENT_F = ["title", "start", "end", "location", "note", "wake", "shared"]
WEEKLY_F = ["title", "weekday", "start_time", "end_time", "location", "wake"]


@app.post("/api/events")
def add_event(body: dict = Body(...)):
    data = pick(body, EVENT_F)
    if "shared" in data:
        data["shared"] = flag(data["shared"])
    id_ = db.insert("events", data)
    if data.get("shared"):
        social.log("event_add", data.get("title", ""), db.me(), id_, push=True)
    refresh_tomorrow()
    return {"id": id_}


@app.patch("/api/events/{id_}")
def edit_event(id_: int, body: dict = Body(...), owner: int | None = None):
    data = pick(body, EVENT_F)
    if owner and int(owner) != db.me():
        data.pop("shared", None)                # 別人的共用行程：可以改內容，不能改成不共用
    elif "shared" in data:
        data["shared"] = flag(data["shared"])
    if data.get("title") is not None and not str(data["title"]).strip():
        raise HTTPException(400, tr("名稱不能是空的"))
    with owned(owner, "events", id_):
        if not db.one("SELECT 1 FROM events WHERE id = ?", (id_,)):
            raise HTTPException(404, tr("找不到這個行程"))
        if data:
            db.update("events", id_, data)
    refresh_tomorrow()
    return {"ok": True}


@app.delete("/api/events/{id_}")
def del_event(id_: int, owner: int | None = None):
    with owned(owner, "events", id_):
        ev = db.one("SELECT * FROM events WHERE id = ?", (id_,))
        db.run("DELETE FROM events WHERE id = ?", (id_,))
        db.run("DELETE FROM comments WHERE event_id = ?", (id_,))
    if ev and ev.get("shared"):
        social.log("event_del", ev["title"], owner or db.me(), None)
    refresh_tomorrow()
    return {"ok": True}


@app.get("/api/events/{id_}")
def get_event(id_: int, owner: int | None = None):
    """單一行程和它的留言。別人的行程只看得到一起的。"""
    me = db.me()
    who = owner or me
    if who != me and not profiles.get(who):
        raise HTTPException(404, tr("沒有這位成員"))
    with db.as_profile(who):
        ev = db.one("SELECT * FROM events WHERE id = ?", (id_,))
        if not ev or (who != me and not ev["shared"]):
            raise HTTPException(404, tr("找不到這個行程"))
        out = ev | {"owner": who, "owner_name": (profiles.get(who) or {}).get("name", ""), "mine": who == me,
                    "comments": social.comments(id_)}
    return out


@app.post("/api/events/{id_}/comments")
def add_comment(id_: int, body: dict = Body(...), owner: int | None = None):
    text = str(body.get("body", "")).strip()[:1000]
    if not text:
        raise HTTPException(400, tr("留言是空的"))
    who = owner or db.me()
    me = db.me()
    with owned(owner, "events", id_):
        ev = db.one("SELECT * FROM events WHERE id = ?", (id_,))
        if not ev:
            raise HTTPException(404, tr("找不到這個行程"))
        cid = db.insert("comments", {"event_id": id_, "author": me, "body": text})
    if ev.get("shared"):
        social.log("comment", ev["title"], who, id_, text, push=True)
    return {"id": cid}


@app.delete("/api/events/{id_}/comments/{cid}")
def del_comment(id_: int, cid: int, owner: int | None = None):
    me = db.me()
    with owned(owner, "events", id_):
        c = db.one("SELECT * FROM comments WHERE id = ? AND event_id = ?", (cid, id_))
        if not c or c["author"] != me:
            raise HTTPException(403, tr("只能刪自己的留言"))
        db.run("DELETE FROM comments WHERE id = ?", (cid,))
    return {"ok": True}


@app.get("/api/activity")
def activity():
    items = social.feed()
    unread, seen = social.unread(), int(db.kv_get("activity_seen", "0") or 0)
    social.mark_seen()
    return {"items": items, "unread": unread, "seen": seen}


@app.get("/api/activity/unread")
def activity_unread():
    return {"n": social.unread() if profiles.multi() else 0}


@app.get("/api/weekly")
def list_weekly():
    return db.rows("SELECT * FROM weekly_events ORDER BY weekday, start_time")


@app.post("/api/weekly")
def add_weekly(body: dict = Body(...)):
    id_ = db.insert("weekly_events", pick(body, WEEKLY_F))
    refresh_tomorrow()
    return {"id": id_}


@app.delete("/api/weekly/{id_}")
def del_weekly(id_: int):
    db.run("DELETE FROM weekly_events WHERE id = ?", (id_,))
    refresh_tomorrow()
    return {"ok": True}


@app.post("/api/skip")
def add_skip(body: dict = Body(...)):
    db.run("INSERT OR REPLACE INTO skip_dates (date, reason) VALUES (?, ?)",
           (body["date"], body.get("reason", "")))
    core.regenerate_plan(body["date"])
    return {"ok": True}


@app.delete("/api/skip/{d}")
def del_skip(d: str):
    db.run("DELETE FROM skip_dates WHERE date = ?", (d,))
    core.regenerate_plan(d)
    return {"ok": True}


# ---------- 待辦 ----------
TASK_F = ["title", "scope", "plan_date", "due", "est_minutes", "link", "done", "shared"]


@app.get("/api/tasks")
def list_tasks(include_done: bool = False):
    return core.tasks_where("1=1" if include_done else "done = 0", (),
                            "COALESCE(plan_date, substr(due,1,10), '9999'), due")


@app.post("/api/tasks")
def add_task(body: dict = Body(...)):
    data = pick(body, TASK_F)
    data.setdefault("scope", "day")
    data.setdefault("plan_date", today())
    if "shared" in data:
        data["shared"] = flag(data["shared"])
    if data["scope"] == "week":
        data["plan_date"] = core.week_monday(data["plan_date"])
    id_ = db.insert("tasks", data)
    if data.get("shared"):
        social.log("task_add", data.get("title", ""), db.me(), id_)
    return {"id": id_}


@app.patch("/api/tasks/{id_}")
def edit_task(id_: int, body: dict = Body(...), owner: int | None = None):
    data = pick(body, TASK_F)
    if "done" in data:
        data["done_at"] = datetime.now().isoformat(timespec="minutes") if data["done"] else None
    if "shared" in data:
        data["shared"] = flag(data["shared"])
    with owned(owner, "tasks", id_):
        db.update("tasks", id_, data)
        t = db.one("SELECT * FROM tasks WHERE id = ?", (id_,))
    if t and t.get("shared") and data.get("done"):
        social.log("task_done", t["title"], owner or db.me(), id_)
    return {"ok": True}


@app.delete("/api/tasks/{id_}")
def del_task(id_: int, owner: int | None = None):
    with owned(owner, "tasks", id_):
        db.run("DELETE FROM tasks WHERE id = ?", (id_,))
    return {"ok": True}


# ---------- 待審核佇列 ----------
INBOX_F = ["ext_id", "kind", "title", "course", "due", "end", "location", "link", "body", "source"]


@app.get("/api/inbox")
def list_inbox(status: str = "pending"):
    return db.rows("SELECT * FROM inbox WHERE status = ? ORDER BY created DESC", (status,))


@app.post("/api/inbox")
def add_inbox(body: dict = Body(...)):
    """任何外部程式都能把新項目丟進來（格式見 app/sources/__init__.py）；ext_id 重複會略過。"""
    id_ = inbox_add(pick(body, INBOX_F))
    return {"id": id_} if id_ else {"duplicate": True}


@app.post("/api/inbox/{id_}/approve")
def approve_inbox(id_: int, body: dict = Body(default={})):
    """核准。kind=event → 建立行程；其他 → 建立待辦，有截止時間的話同時在行事曆放一個截止標記。
    可用 body 覆寫 title/due/plan_date。"""
    it = db.one("SELECT * FROM inbox WHERE id = ?", (id_,))
    if not it or it["status"] != "pending":
        raise HTTPException(404, tr("找不到待審核項目"))
    title = body.get("title") or (f"[{it['course']}] {it['title']}" if it["course"] else it["title"])
    due = body.get("due") or it["due"]
    out = {}
    if it["kind"] == "event":
        allday = bool(due) and due[11:16] == "00:00" and not it["end"]
        out["event_id"] = db.insert("events", {
            "title": title, "start": due or today() + "T09:00", "end": it["end"], "location": it["location"] or "",
            "note": it["link"] or "", "source": it["source"], "wake": 0 if allday else 1})
        db.update("inbox", id_, {"status": "approved"})
        refresh_tomorrow()
        return out
    if it["kind"] != "announcement" or body.get("as_task"):
        out["task_id"] = db.insert("tasks", {
            "title": title, "scope": "day", "due": due, "link": it["link"], "source": it["source"],
            "plan_date": body.get("plan_date") or (due[:10] if due else today()),
            "est_minutes": body.get("est_minutes"),
        })
    if due:
        out["event_id"] = db.insert("events", {
            "title": f"⏰ 截止：{title}", "start": due, "source": it["source"], "wake": 0})
    db.update("inbox", id_, {"status": "approved"})
    return out


@app.post("/api/inbox/{id_}/reject")
def reject_inbox(id_: int):
    db.update("inbox", id_, {"status": "rejected"})
    return {"ok": True}


# ---------- 鬧鐘 ----------
RULE_F = ["name", "weekdays", "anchor", "lead_minutes", "fixed_time", "count", "interval_minutes", "enabled"]


@app.get("/api/alarms/rules")
def list_rules():
    return db.rows("SELECT * FROM alarm_rules ORDER BY id")


@app.post("/api/alarms/rules")
def add_rule(body: dict = Body(...)):
    id_ = db.insert("alarm_rules", pick(body, RULE_F))
    refresh_tomorrow()
    return {"id": id_}


@app.patch("/api/alarms/rules/{id_}")
def edit_rule(id_: int, body: dict = Body(...)):
    db.update("alarm_rules", id_, pick(body, RULE_F))
    refresh_tomorrow()
    return {"ok": True}


@app.delete("/api/alarms/rules/{id_}")
def del_rule(id_: int):
    db.run("DELETE FROM alarm_rules WHERE id = ?", (id_,))
    refresh_tomorrow()
    return {"ok": True}


@app.get("/api/alarms/plan")
def get_plan(d: str | None = None):
    d = d or tomorrow()
    return {"date": d, "preview_reason": core.compute_alarms(d)[1], "alarms": core.plan(d)}


@app.post("/api/alarms/plan/regenerate")
def regen(d: str | None = None):
    return core.regenerate_plan(d or tomorrow())


@app.post("/api/alarms/plan")
def add_alarm(body: dict = Body(...)):
    db.run("INSERT OR REPLACE INTO alarm_plan (date, time, label, source) VALUES (?,?,?,'manual')",
           (body["date"], body["time"], body.get("label", "")))
    return {"ok": True}


@app.patch("/api/alarms/plan/{id_}")
def toggle_alarm(id_: int, body: dict = Body(...)):
    db.update("alarm_plan", id_, pick(body, ["enabled", "time", "label"]))
    return {"ok": True}


@app.delete("/api/alarms/plan/{id_}")
def del_alarm(id_: int):
    db.run("DELETE FROM alarm_plan WHERE id = ?", (id_,))
    return {"ok": True}


# ---------- 手機端（存取碼由 guard 檢查）----------
def phone_list(now: datetime) -> list[dict]:
    """手機該排的鬧鐘：今天還沒到的 + 明天的所有啟用鬧鐘。"""
    hm_now = now.strftime("%H:%M")
    out = [a for a in core.plan(today()) if a["enabled"] and a["time"] > hm_now]
    return out + [a for a in core.plan(tomorrow()) if a["enabled"]]


@app.get("/api/phone/alarms")
def phone_alarms():
    now = datetime.now()
    out = phone_list(now)
    db.kv_set("phone_last_sync", now.isoformat(timespec="minutes"))
    db.kv_set("phone_keys", ",".join(f"{a['date']}T{a['time']}" for a in out))
    return {"server_time": now.isoformat(timespec="seconds"), "awake": bool(wake.awake_at(today())),
            "alarms": [{"date": a["date"], "time": a["time"], "label": tr("起床") if a["label"] in ("", "起床") else a["label"]} for a in out]}


@app.get("/api/alarms/phone")
def phone_state():
    """網頁用：手機有沒有拿到最新的鬧鐘。"""
    now = datetime.now()
    want = [f"{a['date']}T{a['time']}" for a in phone_list(now)]
    cut = now.strftime("%Y-%m-%dT%H:%M")
    got = [k for k in (db.kv_get("phone_keys") or "").split(",") if k > cut]
    last = db.kv_get("phone_last_sync")
    return {"mode": profiles.current()["alarm_mode"], "last": last, "count": len(want),
            "synced": bool(last) and sorted(want) == sorted(got)}


APK = ROOT.parent / "android" / "AsaAlarm.apk"


@app.get("/download/asa.apk")
def download_apk():
    if not APK.exists():
        raise HTTPException(404, tr("還沒有打包好的 App：在電腦上執行 android/build_apk.ps1"))
    return FileResponse(APK, media_type="application/vnd.android.package-archive", filename="Asa.apk")


@app.get("/phone")
def phone_page():
    """把 Asa 裝到手機的說明頁（從設定頁連過來，或在網址帶 ?token=）。"""
    from urllib.parse import quote
    url = (server_urls() or [""])[0]
    tok = profiles.token_of(profiles.current())
    deep = f"asa://setup?url={quote(url, safe='')}&token={quote(tok, safe='')}"
    h = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
    page = (ROOT / "static" / "phone.html").read_text(encoding="utf-8")
    for k, v in {"{{URL}}": h(url), "{{TOKEN}}": h(tok), "{{DEEP}}": h(deep),
                 "{{APK}}": "1" if APK.exists() else ""}.items():
        page = page.replace(k, v)
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})


@app.post("/api/phone/log")
def phone_log(body: dict = Body(...)):
    """手機回報鬧鐘事件（fired / dismissed / awake），用來學習習慣。"""
    data = {"date": body.get("date") or today(), "time": body.get("time"), "action": body["action"]}
    if body.get("ts"):
        data["ts"] = body["ts"]
    db.insert("alarm_log", data)
    if body["action"] == "awake":
        wake.on_awake()
    return {"ok": True}


@app.get("/api/phone/nudge")
def phone_nudge():
    """手機 App 在起床時段每分鐘問一次：有沒有人在叫我、我是不是已經醒了。"""
    n = wake.take_nudge()
    return {"nudge": {"from": n["name"]} if n else None, "awake": bool(wake.awake_at(today()))}


# ---------- 互相叫起床 ----------
@app.get("/api/wake")
def wake_status():
    return {"me": wake.status(), "others": wake.others_status()}


@app.post("/api/wake/awake")
def wake_awake():
    return {"at": wake.mark_awake()}


@app.post("/api/wake/nudge/{pid}")
def wake_nudge(pid: int):
    r = wake.nudge(pid)
    if not r["ok"]:
        raise HTTPException(409, r["reason"])
    return r


# ---------- 個人助理：所在地（天氣） ----------
@app.get("/api/place")
def get_place():
    p = weather.place()
    return {"name": p.get("name", ""), "auto": bool(p.get("auto")), "ts": p.get("ts"),
            "weather": weather.forecast(today()) if p else None}


@app.get("/api/weather/hourly")
def weather_hourly():
    p = weather.place()
    return {"place": p.get("name", ""), "hours": weather.hourly()}


@app.patch("/api/place")
def edit_place(body: dict = Body(...)):
    try:
        p = weather.set_geo(body["lat"], body["lon"]) if "lat" in body else weather.set_place(str(body.get("name", "")))
    except ValueError:
        raise HTTPException(404, tr("地圖上找不到這個地方，換個寫法試試（例如「桃園市中壢區」）")) from None
    except Exception:  # noqa: BLE001
        raise HTTPException(502, tr("查不到座標：連不上地圖服務，等一下再試")) from None
    return {"name": p.get("name", ""), "auto": bool(p.get("auto")), "ts": p.get("ts"),
            "weather": weather.forecast(today()) if p else None}


# ---------- 快速輸入 ----------
@app.post("/api/quick")
def quick_add(body: dict = Body(...)):
    """body: {text, dry}。dry=true 只回傳解析結果，不建立。"""
    p = quick.parse(body.get("text", ""))
    p["summary"] = quick.describe(p)
    if body.get("dry") or p["type"] == "error":
        return p
    if p["type"] == "event":
        db.insert("events", pick(p, EVENT_F))
        refresh_tomorrow()
    elif p["type"] == "task":
        add_task(p)
    elif p["type"] == "alarm":
        add_alarm(p)
    elif p["type"] == "weekly":
        db.insert("weekly_events", pick(p, WEEKLY_F))
        refresh_tomorrow()
    p["created"] = True
    return p


# ---------- 洞察 ----------
@app.get("/api/pressure")
def pressure(days: int = 14):
    """未來 N 天每天的負擔：行程數、要做的待辦、截止數。"""
    out = []
    for i in range(days):
        d = (date.today() + timedelta(days=i)).isoformat()
        out.append({
            "date": d, "weekday": date.fromisoformat(d).weekday(),
            "events": len([e for e in core.events_on(d) if not e["title"].startswith("⏰")]),
            "tasks": db.one("SELECT COUNT(*) n FROM tasks WHERE done=0 AND scope='day' AND plan_date=?", (d,))["n"],
            "due": [t["title"] for t in db.rows(
                "SELECT title FROM tasks WHERE done=0 AND substr(due,1,10)=?", (d,))],
        })
    return out


@app.get("/api/alarms/insights")
def alarm_insights():
    return {"mornings": insights.mornings(14), "suggestions": insights.suggestions()}


def server_urls() -> list[str]:
    """手機可以用來連這台電腦的網址（依優先順序）。"""
    port = os.getenv("PORT", "8787")
    if os.getenv("PUBLIC_URL", "").strip():
        return [os.environ["PUBLIC_URL"].strip().rstrip("/")]
    ips = []
    try:
        ips.append(subprocess.run(["tailscale", "ip", "-4"], capture_output=True, text=True,
                                  timeout=5).stdout.strip().splitlines()[0])
    except Exception:  # noqa: BLE001  沒裝 Tailscale
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))       # 不會真的送封包，只是問系統會走哪個網卡
            ips.append(sk.getsockname()[0])
    except Exception:  # noqa: BLE001
        pass
    return [f"http://{ip}:{port}" for ip in dict.fromkeys(ips) if ip]


@app.get("/api/status")
def status():
    return {
        "channels": [c | {"label": tr(c["label"])} for c in notify.channels()], "lang": i18n.default(),
        "sources": [{"name": m.NAME, "label": tr(m.LABEL), "env": m.ENV, "configured": m.configured(),
                     "last": db.kv_get(f"src_{m.NAME}_last")} for m in sources.ALL],
        "sync_minutes": int(os.getenv("SYNC_INTERVAL_MINUTES", "30")),
        "phone_last_sync": db.kv_get("phone_last_sync"),
        "closure": {"area": closures.area(), "last": db.kv_get("closure_last")},
        "phone_token": profiles.token_of(profiles.current()), "urls": server_urls(),
        "evening": os.getenv("EVENING_TIME", "21:30"), "morning": os.getenv("MORNING_TIME", "08:00"),
    }


@app.post("/api/sources/{name}/run")
def source_run(name: str):
    return job_source(name)


# ---------- 成員 ----------
def profile_view(p: dict, full: bool) -> dict:
    """給前端看的成員資料；full = 自己或管理者才看得到存取碼和設定。"""
    out = {"id": p["id"], "name": p["name"], "color": p["color"], "me": p["id"] == db.me(),
           "avatar": profiles.avatar_url(p)}
    if full:
        with db.as_profile(p["id"]):
            chans = [c | {"label": tr(c["label"])} for c in notify.channels()]
            last = db.kv_get("phone_last_sync")
        out |= {"alarm_mode": p["alarm_mode"], "remind_minutes": p["remind_minutes"], "visible": p["visible"],
                "buddy_minutes": p.get("buddy_minutes", 10),
                "token": profiles.token_of(p), "channels": chans, "phone_last_sync": last}
    return out


@app.get("/api/profiles")
def list_profiles():
    ps = profiles.all()
    return {"me": profile_view(profiles.current(), True), "multi": len(ps) > 1, "local": LOCAL.get(),
            "admin": is_admin(), "list": [profile_view(p, is_admin() or p["id"] == db.me()) for p in ps]}


@app.post("/api/profiles")
def add_profile(body: dict = Body(...)):
    if not is_admin():
        raise HTTPException(403, tr("只有第一位成員或這台電腦可以管理成員"))
    return profile_view(profiles.create(str(body.get("name", ""))), True)


@app.patch("/api/profiles/{id_}")
def edit_profile(id_: int, body: dict = Body(...)):
    if not (is_admin() or id_ == db.me()):
        raise HTTPException(403, tr("只能改自己的設定"))
    if not profiles.get(id_):
        raise HTTPException(404, tr("沒有這位成員"))
    try:
        profiles.update(id_, body)
    except ValueError:
        raise HTTPException(400, tr("設定值不正確")) from None
    with db.as_profile(id_):
        if profiles.current()["alarm_mode"] != "off":
            default_rules()
        core.regenerate_plan(tomorrow())
    return {"ok": True}


@app.delete("/api/profiles/{id_}")
def del_profile(id_: int):
    if not is_admin():
        raise HTTPException(403, tr("只有第一位成員或這台電腦可以管理成員"))
    try:
        profiles.delete(id_)
    except ValueError:
        raise HTTPException(400, tr("第一位成員不能移除")) from None
    return {"ok": True}


@app.post("/api/profiles/{id_}/switch")
def switch_profile(id_: int):
    """在這台電腦的瀏覽器上切換成另一位成員（其他裝置是由存取碼決定，不能切）。"""
    if not LOCAL.get():
        raise HTTPException(403, tr("其他裝置要用那位成員自己的存取碼"))
    if not profiles.get(id_):
        raise HTTPException(404, tr("沒有這位成員"))
    resp = JSONResponse({"ok": True})
    resp.set_cookie("asa_profile", str(id_), max_age=31536000, samesite="lax")
    return resp


@app.post("/api/profiles/{id_}/avatar")
def upload_avatar(id_: int, body: dict = Body(...)):
    """body: {data: "data:image/jpeg;base64,…"}（前端會先裁成 256×256）"""
    if not (is_admin() or id_ == db.me()):
        raise HTTPException(403, tr("只能改自己的設定"))
    if not profiles.get(id_):
        raise HTTPException(404, tr("沒有這位成員"))
    head, _, b64 = str(body.get("data", "")).partition(",")
    try:
        profiles.set_avatar(id_, head.removeprefix("data:").removesuffix(";base64"), base64.b64decode(b64, validate=True))
    except (ValueError, binascii.Error):
        raise HTTPException(400, tr("圖片格式不支援或太大")) from None
    return {"avatar": profiles.avatar_url(profiles.get(id_))}


@app.delete("/api/profiles/{id_}/avatar")
def delete_avatar(id_: int):
    if not (is_admin() or id_ == db.me()):
        raise HTTPException(403, tr("只能改自己的設定"))
    profiles.clear_avatar(id_)
    return {"ok": True}


@app.get("/api/avatar/{id_}")
def get_avatar(id_: int):
    f = profiles.avatar_file(id_)
    if not f:
        raise HTTPException(404, tr("沒有這位成員"))
    return FileResponse(f, headers={"Cache-Control": "private, max-age=31536000"})


@app.post("/api/profiles/{id_}/test")
def test_profile(id_: int):
    if not (is_admin() or id_ == db.me()):
        raise HTTPException(403, tr("只能改自己的設定"))
    with db.as_profile(id_):
        return notify.send(tr("✅ Asa 通知測試成功"))


# ---------- 通知 ----------
@app.post("/api/notify/test")
def notify_test():
    return notify.send(tr("✅ Asa 通知測試成功"))


@app.post("/api/notify/brief")
def notify_brief(kind: str = "evening"):
    d = tomorrow() if kind == "evening" else today()
    text = core.brief_text(d, kind)
    return {"text": text, "result": notify.send(text)}


@app.get("/api/brief")
def brief(kind: str = "evening"):
    return {"text": core.brief_text(tomorrow() if kind == "evening" else today(), kind)}
