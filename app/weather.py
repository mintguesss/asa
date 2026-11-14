"""天氣：早安簡報、晚上預告用。

所在地存在每位成員自己的 kv「place」：{"name": "桃園市中壢區", "geo": [緯度, 經度]}。
座標用 OpenStreetMap 的 Nominatim 查一次就記住；天氣用 Open-Meteo（不用金鑰）。
這兩個服務只會收到你填的地名和它的座標。
"""
import json
import time

import httpx

from . import db
from .i18n import tr

UA = {"User-Agent": "Asa-selfhosted/1.0"}
OFFLINE = False          # 示範模式：不連外部服務

# Open-Meteo 的 WMO 天氣代碼
CODES = [((0,), "☀️", "晴"), ((1,), "🌤", "晴時多雲"), ((2,), "⛅", "多雲"), ((3,), "☁️", "陰"),
         ((45, 48), "🌫", "有霧"), ((51, 53, 55, 56, 57), "🌦", "毛毛雨"), ((61, 63, 80, 81), "🌧", "有雨"),
         ((65, 82), "🌧", "大雨"), ((66, 67), "🌧", "凍雨"), ((71, 73, 75, 77, 85, 86), "🌨", "下雪"),
         ((95, 96, 99), "⛈", "雷雨")]


def place() -> dict:
    try:
        return json.loads(db.kv_get("place") or "{}")
    except ValueError:
        return {}


def geocode(q: str) -> tuple[float, float] | None:
    r = httpx.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 1},
                  headers=UA, timeout=8)
    js = r.json() if r.status_code == 200 else []
    return (float(js[0]["lat"]), float(js[0]["lon"])) if js else None


def set_place(name: str) -> dict:
    """設定所在地；查不到座標就丟 ValueError。空字串 = 清掉。"""
    name = name.strip()[:80]
    if not name:
        db.kv_set("place", "")
        return {}
    g = None if OFFLINE else geocode(name)
    if not g and not OFFLINE:
        raise ValueError(name)
    p = {"name": name, "geo": list(g) if g else None}
    db.kv_set("place", json.dumps(p, ensure_ascii=False))
    db.run("DELETE FROM kv WHERE key LIKE 'wx:%'")
    return p


def _desc(code: int) -> tuple[str, str]:
    for codes, icon, text in CODES:
        if code in codes:
            return icon, tr(text)
    return "🌡", ""


def forecast(d: str) -> dict | None:
    """某天的天氣：{icon, text, hi, lo, rain, now}；沒設所在地或查不到就回傳 None。一小時內用快取。"""
    p = place()
    if not p.get("geo") or OFFLINE:
        return None
    key = "wx:" + d
    raw = db.kv_get(key)
    if raw:
        v = json.loads(raw)
        if time.time() - v["ts"] < 3600:
            return v["data"]
    lat, lon = p["geo"]
    try:
        r = httpx.get("https://api.open-meteo.com/v1/forecast", headers=UA, timeout=8, params={
            "latitude": lat, "longitude": lon, "timezone": "auto", "start_date": d, "end_date": d,
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "current": "temperature_2m"})
        js = r.json() if r.status_code == 200 else {}
        dl = js["daily"]
        icon, text = _desc(int(dl["weather_code"][0]))
        data = {"icon": icon, "text": text, "hi": round(dl["temperature_2m_max"][0]), "lo": round(dl["temperature_2m_min"][0]),
                "rain": dl["precipitation_probability_max"][0], "now": round(js.get("current", {}).get("temperature_2m"))
                if js.get("current", {}).get("temperature_2m") is not None else None}
    except Exception:  # noqa: BLE001  連不上就不顯示天氣
        return None
    db.kv_set(key, json.dumps({"ts": time.time(), "data": data}))
    return data


def line(d: str, today: bool) -> str | None:
    """簡報裡的一行天氣。"""
    w = forecast(d)
    if not w:
        return None
    s = tr("{icon} {where}：{text}，{lo}～{hi}°C", icon=w["icon"], where=place()["name"], text=w["text"], lo=w["lo"], hi=w["hi"])
    if today and w["now"] is not None:
        s += tr("（現在 {t}°C）", t=w["now"])
    if w["rain"] is not None:
        s += tr("，降雨機率 {p}%", p=w["rain"])
        if w["rain"] >= 50:
            s += tr("，記得帶傘 ☂️")
    return s
