"""核心邏輯：某天的行程、鬧鐘排程、每日簡報文字。"""
from datetime import date, datetime, timedelta

from . import db
from .i18n import tr, wd as wd_name

WD = "一二三四五六日"


def events_on(d: str) -> list[dict]:
    """某天的所有行程 = 單次行程 + 每週固定行程（放假日不算），依開始時間排序。"""
    out = db.rows("SELECT * FROM events WHERE substr(start,1,10) = ?", (d,))
    for e in out:
        e["time"] = e["start"][11:16]
        e["end_time"] = (e["end"] or "")[11:16]
    if not db.one("SELECT 1 FROM skip_dates WHERE date = ?", (d,)):
        wd = date.fromisoformat(d).weekday()
        for w in db.rows("SELECT * FROM weekly_events WHERE weekday = ?", (wd,)):
            out.append({
                "id": None, "weekly_id": w["id"], "title": w["title"],
                "time": w["start_time"], "end_time": w["end_time"] or "",
                "location": w["location"], "source": "weekly", "wake": w["wake"],
            })
    return sorted(out, key=lambda e: e["time"])


def compute_alarms(d: str) -> tuple[list[str], str]:
    """依規則算出某天的鬧鐘時間，回傳 (時間清單, 說明)。"""
    wd = date.fromisoformat(d).weekday()
    rule = next(
        (r for r in db.rows("SELECT * FROM alarm_rules WHERE enabled = 1 ORDER BY id")
         if str(wd) in r["weekdays"].split(",")),
        None,
    )
    if not rule:
        return [], tr("這天沒有適用的鬧鐘規則")

    first = None
    why = ""
    if rule["anchor"] == "first_event":
        ev = next((e for e in events_on(d) if e["wake"] and e["time"]), None)
        if ev:
            t = datetime.fromisoformat(f"{d}T{ev['time']}")
            first = t - timedelta(minutes=rule["lead_minutes"])
            why = tr("{time} {title}，提前 {lead} 分鐘開始", time=ev["time"], title=ev["title"], lead=rule["lead_minutes"])
    if first is None and rule["fixed_time"]:
        first = datetime.fromisoformat(f"{d}T{rule['fixed_time']}")
        why = tr("固定時間 {time}" if rule["anchor"] == "fixed" else "當天沒有行程，用備用時間 {time}", time=rule["fixed_time"])
    if first is None:
        return [], tr("當天沒有行程，不排鬧鐘")

    times = []
    for i in range(rule["count"]):
        t = first + timedelta(minutes=i * rule["interval_minutes"])
        if t.date().isoformat() == d:           # 不跨日
            times.append(t.strftime("%H:%M"))
    return times, tr("【{rule}】{why}", rule=rule["name"], why=why)


def regenerate_plan(d: str) -> dict:
    """重排某天的自動鬧鐘（手動加的保留）。"""
    times, why = compute_alarms(d)
    db.run("DELETE FROM alarm_plan WHERE date = ? AND source = 'auto'", (d,))
    for t in times:
        db.run("INSERT OR IGNORE INTO alarm_plan (date, time, label, source) VALUES (?,?,?,'auto')",
               (d, t, "起床"))
    return {"date": d, "reason": why, "alarms": plan(d)}


def plan(d: str) -> list[dict]:
    return db.rows("SELECT * FROM alarm_plan WHERE date = ? ORDER BY time", (d,))


def week_monday(d: str) -> str:
    dt = date.fromisoformat(d)
    return (dt - timedelta(days=dt.weekday())).isoformat()


def tasks_for(d: str) -> dict:
    """某天要看的待辦：當日、逾期未完成、本週待辦。"""
    mon = week_monday(d)
    return {
        "day": db.rows("SELECT * FROM tasks WHERE scope='day' AND plan_date = ? ORDER BY done, due", (d,)),
        "overdue": db.rows(
            "SELECT * FROM tasks WHERE done = 0 AND scope='day' AND plan_date < ? ORDER BY plan_date", (d,)),
        "week": db.rows("SELECT * FROM tasks WHERE scope='week' AND plan_date = ? ORDER BY done, due", (mon,)),
        "upcoming_due": db.rows(
            "SELECT * FROM tasks WHERE done = 0 AND due IS NOT NULL AND substr(due,1,10) BETWEEN ? AND ? ORDER BY due",
            (d, (date.fromisoformat(d) + timedelta(days=7)).isoformat())),
    }


def day_summary(d: str) -> dict:
    return {
        "date": d,
        "weekday": WD[date.fromisoformat(d).weekday()],
        "skip": db.one("SELECT * FROM skip_dates WHERE date = ?", (d,)),
        "events": events_on(d),
        "tasks": tasks_for(d),
        "alarms": plan(d),
        "inbox_pending": db.one("SELECT COUNT(*) n FROM inbox WHERE status='pending'")["n"],
    }


def brief_text(d: str, kind: str) -> str:
    """kind = evening（前一晚預告 d 這天）或 morning（d 當天早上）。"""
    s = day_summary(d)
    head = tr("🌙 明日預告") if kind == "evening" else tr("☀️ 今日簡報")
    lines = [tr("{head}｜{date}（{wd}）", head=head, date=d[5:], wd=wd_name(date.fromisoformat(d).weekday()))]
    if s["skip"]:
        lines.append(f"🚫 {s['skip']['reason'] or tr('放假')}")

    on = [a["time"] for a in s["alarms"] if a["enabled"]]
    if kind == "evening":
        lines.append(tr("⏰ 鬧鐘 {n} 個：{a}～{b}", n=len(on), a=on[0], b=on[-1]) if on else tr("⏰ 明天沒有排鬧鐘"))

    lines.append(tr("📅 行程：") + ("" if s["events"] else tr("無")))
    for e in s["events"]:
        loc = f"（{e['location']}）" if e.get("location") else ""
        lines.append(f"  {e['time']} {e['title']}{loc}")

    t = s["tasks"]
    todo = [x for x in t["day"] if not x["done"]]
    if todo or t["overdue"]:
        lines.append(tr("📝 待辦："))
        lines += [f"  ☐ {x['title']}" for x in todo]
        lines += [f"  ⚠️ {x['title']}" + tr("（原訂 {d}）", d=x["plan_date"][5:]) for x in t["overdue"]]
    wk = [x for x in t["week"] if not x["done"]]
    if wk:
        lines.append(tr("🗓 本週待辦：") + tr("、").join(x["title"] for x in wk))
    if t["upcoming_due"]:
        lines.append(tr("⏳ 七天內截止："))
        lines += [f"  {x['due'][5:10]} {x['due'][11:16]} {x['title']}" for x in t["upcoming_due"]]
    if s["inbox_pending"]:
        lines.append(tr("📥 有 {n} 則待審核", n=s["inbox_pending"]))
    return "\n".join(lines)
