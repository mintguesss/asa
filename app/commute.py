"""通勤：依行程地點的交通時間（下雨再多留一點）自動把鬧鐘往前調。

設定存在每位成員自己的 kv「commute」：
    {"on": true, "home": "家的地址", "mode": "car|bike|foot", "default": 0, "rain": 10}
常用地點存在 places 表：名稱 → 分鐘。行程地點只要「包含」某個常用地點的名稱就套用，
例如常用地點「理學院」會套到「理學院 S-205」。

找不到的地點會試著自動估一次（OpenStreetMap 的 Nominatim 查座標、FOSSGIS 的 OSRM 算路線），
估到的寫進常用地點（標成自動估的，可以自己改）；估不到就用預設分鐘數。
下雨用 Open-Meteo 的降雨機率（不用金鑰）。這些服務都只會收到你填的地址和行程地點。
自動估算不含即時路況，也沒有大眾運輸：搭捷運、公車的話請在常用地點自己填分鐘數。
"""
import json
import math
import time

import httpx

from . import db
from .i18n import tr

MODES = ("car", "bike", "foot")
UA = {"User-Agent": "Asa-selfhosted/1.0 (alarm planner)"}
DEFAULTS = {"on": False, "home": "", "mode": "car", "default": 0, "rain": 10}
RAIN_PROB = 50           # 降雨機率幾 % 以上算會下雨
PARK = 5                 # 自動估的時間再加幾分鐘（停車、走進教室）
OFFLINE = False          # 示範模式：不連外部服務


def settings() -> dict:
    try:
        own = json.loads(db.kv_get("commute") or "{}")
    except ValueError:
        own = {}
    return DEFAULTS | own


def save(data: dict) -> dict:
    cur = settings()
    if "on" in data:
        cur["on"] = bool(data["on"])
    if "home" in data:
        home = str(data["home"]).strip()[:200]
        if home != cur["home"]:
            db.kv_set("home_geo", "")           # 換地址就重查座標，自動估的地點也重估
            db.run("DELETE FROM places WHERE auto = 1")
        cur["home"] = home
    if data.get("mode") in MODES:
        if data["mode"] != cur["mode"]:
            db.run("DELETE FROM places WHERE auto = 1")
        cur["mode"] = data["mode"]
    for k, hi in (("default", 240), ("rain", 120)):
        if k in data:
            cur[k] = max(0, min(hi, int(data[k] or 0)))
    db.kv_set("commute", json.dumps(cur, ensure_ascii=False))
    return cur


def places() -> list[dict]:
    return db.rows("SELECT * FROM places ORDER BY auto, name")


def set_place(name: str, minutes: int) -> None:
    name = name.strip()[:60]
    if not name:
        raise ValueError("empty")
    db.run("INSERT OR REPLACE INTO places (name, minutes, auto) VALUES (?, ?, 0)", (name, max(0, min(300, int(minutes)))))


def del_place(name: str) -> None:
    db.run("DELETE FROM places WHERE name = ?", (name,))


# ---------- 外部服務 ----------
def _geocode(q: str) -> tuple[float, float] | None:
    r = httpx.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1},
                  headers=UA, timeout=8)
    js = r.json() if r.status_code == 200 else []
    return (float(js[0]["lat"]), float(js[0]["lon"])) if js else None


def _route(a: tuple[float, float], b: tuple[float, float], mode: str) -> int | None:
    prof = {"car": "routed-car", "bike": "routed-bike", "foot": "routed-foot"}[mode]
    url = f"https://routing.openstreetmap.de/{prof}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}"
    r = httpx.get(url, params={"overview": "false"}, headers=UA, timeout=8)
    js = r.json() if r.status_code == 200 else {}
    if js.get("code") != "Ok" or not js.get("routes"):
        return None
    return math.ceil(js["routes"][0]["duration"] / 60)


def _rain(lat: float, lon: float, d: str, hour: int) -> int | None:
    r = httpx.get("https://api.open-meteo.com/v1/forecast",
                  params={"latitude": lat, "longitude": lon, "hourly": "precipitation_probability",
                          "timezone": "auto", "start_date": d, "end_date": d}, headers=UA, timeout=8)
    js = r.json() if r.status_code == 200 else {}
    probs = (js.get("hourly") or {}).get("precipitation_probability") or []
    return probs[hour] if hour < len(probs) and probs[hour] is not None else None


def home_geo() -> tuple[float, float] | None:
    s = settings()
    if not s["home"] or OFFLINE:
        return None
    raw = db.kv_get("home_geo")
    if raw:
        v = json.loads(raw)
        return tuple(v) if v else None
    try:
        g = _geocode(s["home"])
    except Exception:  # noqa: BLE001
        return None                             # 連不上就下次再試，不記失敗
    db.kv_set("home_geo", json.dumps(g))
    return g


def estimate(location: str) -> int | None:
    """自動估某個地點的交通分鐘數（含停車），估到就存成常用地點。"""
    s = settings()
    home = home_geo()
    if not home or OFFLINE:
        return None
    key = "geo_miss:" + location
    if db.kv_get(key):                          # 一週內查不到的地點不再重查
        if time.time() - float(db.kv_get(key)) < 7 * 86400:
            return None
    try:
        g = _geocode(location)
        m = _route(home, g, s["mode"]) if g else None
    except Exception:  # noqa: BLE001
        return None
    if m is None:
        db.kv_set(key, str(time.time()))
        return None
    m += PARK
    db.run("INSERT OR REPLACE INTO places (name, minutes, auto) VALUES (?, ?, 1)", (location.strip()[:60], m))
    return m


def travel(location: str) -> tuple[int, str]:
    """(分鐘, 說明)。"""
    s = settings()
    loc = (location or "").strip()
    if loc:
        for p in sorted(places(), key=lambda p: -len(p["name"])):    # 名稱長的優先（比較具體）
            if p["name"] and (p["name"] in loc or loc in p["name"]):
                return p["minutes"], p["name"]
        m = estimate(loc)
        if m is not None:
            return m, loc
    return s["default"], tr("預設")


def rain_extra(d: str, hhmm: str) -> tuple[int, int | None]:
    """出門那個小時會下雨的話多留幾分鐘：(分鐘, 降雨機率)。"""
    s = settings()
    if not s["rain"] or OFFLINE:
        return 0, None
    geo = home_geo()
    if not geo:
        return 0, None
    key = f"rain:{d}:{hhmm[:2]}"
    raw = db.kv_get(key)
    if raw and time.time() - json.loads(raw)[1] < 3600:              # 一小時內查過就用快取
        prob = json.loads(raw)[0]
    else:
        try:
            prob = _rain(geo[0], geo[1], d, int(hhmm[:2]))
        except Exception:  # noqa: BLE001
            return 0, None
        db.kv_set(key, json.dumps([prob, time.time()]))
    return (s["rain"], prob) if prob is not None and prob >= RAIN_PROB else (0, prob)


def plan_for(d: str, ev: dict) -> tuple[int, str] | None:
    """這個行程要多留多少交通時間：(分鐘, 說明)；沒開通勤就回傳 None。"""
    s = settings()
    if not s["on"]:
        return None
    m, where = travel(ev.get("location") or "")
    leave = max(0, int(ev["time"][:2]) * 60 + int(ev["time"][3:]) - m)
    extra, prob = rain_extra(d, f"{leave // 60:02d}:{leave % 60:02d}")
    why = tr("通勤 {m} 分鐘（{where}）", m=m, where=where)
    if extra:
        why += tr("＋下雨 {m} 分鐘（降雨 {p}%）", m=extra, p=prob)
    return m + extra, why
