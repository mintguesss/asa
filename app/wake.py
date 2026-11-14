"""互相叫起床：兩個人互相看得到對方醒了沒，叫不醒就通知對方、讓對方遠端叫你。

- 「醒了」= 手機 App 按「我醒了」（/api/phone/log 的 awake），或在網頁上按「我醒了」。
- 最後一個鬧鐘過了 N 分鐘還沒醒（成員設定 buddy_minutes，0 = 不通知），推播給其他成員。
- 其他成員可以按「叫他起床」：
  · 用手機 App 的人：App 在起床時段每分鐘問一次，收到就大聲響鈴（/api/phone/nudge）。
  · 用推播的人（iPhone）：送一則最高優先的推播（ntfy 會用 urgent）。
- 起床、被叫都記在動態裡，不另外推播（不然一早手機一直響）。
"""
import json
from datetime import datetime, timedelta

from . import db, notify, profiles, social
from .i18n import tr

WINDOW = 3 * 60          # 最後一個鬧鐘之後幾分鐘內還算「起床時段」
NUDGE_GAP = 60           # 同一個人兩次「叫起床」至少隔幾秒
NUDGE_TTL = 10 * 60      # 手機 App 多久之內拿到才響（太舊的就不響了）


def _mins(hm: str) -> int:
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def _today() -> str:
    return datetime.now().date().isoformat()


def awake_at(d: str) -> str | None:
    r = db.one("SELECT ts FROM alarm_log WHERE date = ? AND action = 'awake' ORDER BY ts LIMIT 1", (d,))
    return r["ts"][11:16] if r and r["ts"] else None


def status(now: datetime | None = None) -> dict | None:
    """目前這位成員今天的起床狀態；不用鬧鐘的人回傳 None。

    state：none（今天沒鬧鐘）/ waiting（還沒到第一個鬧鐘）/ ringing（鬧鐘響了還沒醒）
           / late（最後一個鬧鐘過了 N 分鐘還沒醒）/ awake / over（起床時段過了，沒回報）
    """
    from . import core
    p = profiles.current()
    if p["alarm_mode"] == "off":
        return None
    now = now or datetime.now()
    d = now.date().isoformat()
    on = [a["time"] for a in core.plan(d) if a["enabled"]]
    at = awake_at(d)
    out = {"first": on[0] if on else None, "last": on[-1] if on else None, "at": at,
           "grace": p.get("buddy_minutes", 10)}
    if at:
        return out | {"state": "awake"}
    if not on:
        return out | {"state": "none"}
    n, first, last = now.hour * 60 + now.minute, _mins(on[0]), _mins(on[-1])
    if n < first:
        state = "waiting"
    elif n > last + WINDOW:
        state = "over"
    elif n >= last + max(1, out["grace"] or 10):
        state = "late"
    else:
        state = "ringing"
    nudge = _nudge()
    return out | {"state": state, "nudged": nudge.get("name") if nudge else None}


def _nudge() -> dict | None:
    raw = db.kv_get("nudge")
    if not raw:
        return None
    n = json.loads(raw)
    return n if datetime.now().timestamp() - n["ts"] < NUDGE_TTL else None


def mark_awake(source: str = "web") -> str:
    """網頁上按「我醒了」。手機 App 的「我醒了」走 /api/phone/log，最後也會呼叫 on_awake。"""
    now = datetime.now()
    if not awake_at(now.date().isoformat()):
        db.insert("alarm_log", {"date": now.date().isoformat(), "time": now.strftime("%H:%M"), "action": "awake",
                                "ts": now.strftime("%Y-%m-%d %H:%M:%S")})
        on_awake(now)
    return now.strftime("%H:%M")


def on_awake(now: datetime | None = None) -> None:
    now = now or datetime.now()
    db.kv_set("nudge", "")
    until = min(now + timedelta(minutes=WINDOW), now.replace(hour=23, minute=59))
    db.run("UPDATE alarm_plan SET enabled = 0 WHERE date = ? AND enabled = 1 AND time > ? AND time <= ?",
           (now.date().isoformat(), now.strftime("%H:%M"), until.strftime("%H:%M")))
    if db.kv_get("awake_logged") != now.date().isoformat():
        db.kv_set("awake_logged", now.date().isoformat())
        social.log("awake", now.strftime("%H:%M"), db.me(), None)


def nudge(target: int) -> dict:
    """叫某位成員起床。回傳 {"ok": bool, "how": "app" / "push", "reason": …}"""
    actor = profiles.current()
    p = profiles.get(target)
    if not p or p["id"] == actor["id"]:
        return {"ok": False, "reason": tr("沒有這位成員")}
    with db.as_profile(p["id"]):
        last = _nudge()
        if last and datetime.now().timestamp() - last["ts"] < NUDGE_GAP:
            return {"ok": False, "reason": tr("剛剛叫過了，等一分鐘再叫")}
        if awake_at(_today()):
            return {"ok": False, "reason": tr("{name} 已經起床了", name=p["name"])}
        db.kv_set("nudge", json.dumps({"from": actor["id"], "name": actor["name"], "ts": datetime.now().timestamp()}))
        from . import i18n
        i18n.set_lang(p.get("lang"))
        try:
            notify.send(tr("📣 {who} 在叫你起床！", who=actor["name"]), urgent=True)
        except Exception:  # noqa: BLE001
            pass
        i18n.set_lang(None)
    social.log("nudge", p["name"], p["id"], None)
    return {"ok": True, "how": "app" if p["alarm_mode"] == "app" else "push"}


def take_nudge() -> dict | None:
    """手機 App 來拿「有人在叫我」；拿到就清掉，只響一次。"""
    n = _nudge()
    if n:
        db.kv_set("nudge", "")
    return n


def job(link: str = "", now: datetime | None = None) -> None:
    """每分鐘：誰叫不醒，就通知其他成員（每人每天最多一次）。"""
    if not profiles.multi():
        return
    now = now or datetime.now()
    for p in profiles.each():
        if not p.get("buddy_minutes"):
            continue
        st = status(now)
        if not st or st["state"] != "late" or db.kv_get("buddy_alerted") == now.date().isoformat():
            continue
        db.kv_set("buddy_alerted", now.date().isoformat())
        late = now.hour * 60 + now.minute - _mins(st["last"])
        for o in profiles.others():
            with db.as_profile(o["id"]):
                from . import i18n
                i18n.set_lang(o.get("lang"))
                text = tr("😴 {name} 還沒起床：最後一個鬧鐘 {last} 已經過了 {n} 分鐘。", name=p["name"],
                          last=st["last"], n=late)
                if link:
                    text += "\n" + tr("👉 打開 Asa 叫他起床：{url}", url=link)
                try:
                    notify.send(text, urgent=True)
                except Exception:  # noqa: BLE001
                    pass
                i18n.set_lang(None)


def others_status() -> list[dict]:
    """其他成員今天的起床狀態（首頁用）。"""
    out = []
    for p in profiles.others():
        with db.as_profile(p["id"]):
            st = status()
        if st:
            out.append({"id": p["id"], **st, "mode": p["alarm_mode"]})
    return out

