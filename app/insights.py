"""習慣學習：從手機回報的起床紀錄，找出每條鬧鐘規則該怎麼調。"""
from datetime import date
from statistics import median

from . import db
from .i18n import tr

MIN_SAMPLES = 3


def _mins(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:5])


def mornings(limit_days: int = 60) -> list[dict]:
    """每個有「確認起床」紀錄的早上：第一個鬧鐘、最後一個鬧鐘、實際起床時間。"""
    out = []
    for r in db.rows(
        "SELECT date, MIN(substr(ts, 12, 5)) awake FROM alarm_log WHERE action = 'awake' "
        "GROUP BY date ORDER BY date DESC LIMIT ?", (limit_days,)):
        alarms = [a["time"] for a in db.rows(
            "SELECT time FROM alarm_plan WHERE date = ? AND enabled = 1 ORDER BY time", (r["date"],))]
        # 只看起床前後 4 小時內的那一組鬧鐘
        group = [a for a in alarms if abs(_mins(a) - _mins(r["awake"])) <= 240]
        if not group:
            continue
        out.append({
            "date": r["date"], "weekday": date.fromisoformat(r["date"]).weekday(),
            "first": group[0], "last": group[-1], "count": len(group), "awake": r["awake"],
            "delay": _mins(r["awake"]) - _mins(group[0]),
            "rang": sum(1 for a in group if _mins(a) <= _mins(r["awake"])),
        })
    return out


def suggestions() -> list[dict]:
    """對每條規則給出調整建議（附上可以直接套用的 patch）。"""
    ms = mornings()
    out = []
    for rule in db.rows("SELECT * FROM alarm_rules WHERE enabled = 1"):
        wds = {int(x) for x in rule["weekdays"].split(",") if x != ""}
        mine = [m for m in ms if m["weekday"] in wds]
        if len(mine) < MIN_SAMPLES:
            out.append({"rule_id": rule["id"], "rule": rule["name"], "samples": len(mine),
                        "text": tr("資料還不夠（{n}/{need} 個早上），再累積幾天就會有建議。", n=len(mine), need=MIN_SAMPLES), "patch": None})
            continue
        delay = round(median(m["delay"] for m in mine))
        span = (rule["count"] - 1) * rule["interval_minutes"]
        late = sum(1 for m in mine if m["delay"] > span)          # 最後一個響完才起床
        early = sum(1 for m in mine if m["rang"] <= 2)            # 前兩個就起來了
        base = tr("最近 {n} 個早上，你通常在第一個鬧鐘後 {delay} 分鐘起床。", n=len(mine), delay=delay)
        if late >= len(mine) / 2:
            add = max(2, round((delay - span) / rule["interval_minutes"]) + 1)
            out.append({"rule_id": rule["id"], "rule": rule["name"], "samples": len(mine),
                        "text": base + tr("有 {late} 次是最後一個鬧鐘響完才起來，建議多加 {add} 個並提早 {early} 分鐘開始。", late=late, add=add, early=add * rule["interval_minutes"]),
                        "short": tr("多 {add} 個、提早 {early} 分鐘", add=add, early=add * rule["interval_minutes"]),
                        "patch": {"count": rule["count"] + add,
                                  "lead_minutes": rule["lead_minutes"] + add * rule["interval_minutes"]}})
        elif early >= len(mine) * 0.7 and rule["count"] > 3:
            out.append({"rule_id": rule["id"], "rule": rule["name"], "samples": len(mine),
                        "text": base + tr("有 {early} 次前兩個就起床了，可以減到 {n} 個。", early=early, n=max(3, rule["count"] - 2)),
                        "short": tr("減到 {n} 個", n=max(3, rule["count"] - 2)),
                        "patch": {"count": max(3, rule["count"] - 2)}})
        elif delay >= 3 * rule["interval_minutes"]:
            skip = delay // rule["interval_minutes"] - 1
            out.append({"rule_id": rule["id"], "rule": rule["name"], "samples": len(mine),
                        "text": base + tr("前 {skip} 個幾乎叫不醒你，可以改成晚一點開始、間隔更密（每 {gap} 分鐘）。", skip=skip, gap=max(2, rule["interval_minutes"] - 2)),
                        "short": tr("晚 {later} 分鐘開始、每 {gap} 分鐘一個", later=skip * rule["interval_minutes"], gap=max(2, rule["interval_minutes"] - 2)),
                        "patch": {"lead_minutes": max(10, rule["lead_minutes"] - skip * rule["interval_minutes"]),
                                  "interval_minutes": max(2, rule["interval_minutes"] - 2)}})
        else:
            out.append({"rule_id": rule["id"], "rule": rule["name"], "samples": len(mine),
                        "text": base + tr("目前的設定跟你的習慣相符，不用調整。"), "patch": None})
    return out
