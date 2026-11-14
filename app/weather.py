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


def reverse(lat: float, lon: float) -> str:
    """座標 → 地名（到區／鄉鎮）。查不到就回傳空字串。"""
    try:
        r = httpx.get("https://nominatim.openstreetmap.org/reverse", headers=UA, timeout=8,
                      params={"lat": lat, "lon": lon, "format": "json", "zoom": 14, "accept-language": "zh-TW,en"})
        a = (r.json() if r.status_code == 200 else {}).get("address", {})
    except Exception:  # noqa: BLE001
        return ""
    city = a.get("city") or a.get("county") or a.get("state") or ""
    # 台灣的「區／鎮／鄉」在不同地方會放在不同欄位；找不到才退回里、村
    keys = ("city_district", "district", "suburb", "town", "borough", "municipality")
    area = next((a[k] for k in keys if str(a.get(k, "")).endswith(("區", "鎮", "鄉", "市"))), "")         or next((a[k] for k in keys if a.get(k)), "") or a.get("village") or ""
    return (city + area) if city != area else city


def set_geo(lat: float, lon: float) -> dict:
    """手機回報目前位置。移動不到 2 公里就不重查地名。"""
    lat, lon = round(float(lat), 3), round(float(lon), 3)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("geo")
    old = place()
    if old.get("v") == 2 and old.get("geo") and abs(old["geo"][0] - lat) < 0.02 and abs(old["geo"][1] - lon) < 0.02 and old.get("name"):
        p = old | {"ts": time.time()}
    else:
        p = {"name": ("" if OFFLINE else reverse(lat, lon)) or tr("目前位置"), "geo": [lat, lon], "ts": time.time(), "auto": 1, "v": 2}
        db.run("DELETE FROM kv WHERE key LIKE 'wx:%'")
    db.kv_set("place", json.dumps(p, ensure_ascii=False))
    return p


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


FRESH = 1800             # 天氣資料半小時內不重抓
FAIL_WAIT = 600          # 兩個服務都連不上：十分鐘內不再試（不然每次打開首頁都要等逾時）

# 挪威氣象局（備用）的天氣符號 → Open-Meteo 的 WMO 代碼
MET = [("thunder", 95), ("heavysnow", 75), ("snow", 71), ("sleet", 66), ("heavyrain", 65), ("rainshowers", 80),
       ("lightrain", 51), ("rain", 61), ("fog", 45), ("cloudy", 3), ("partlycloudy", 2), ("fair", 1), ("clearsky", 0)]


def _met_code(sym: str) -> int:
    sym = (sym or "").split("_")[0]
    if sym.startswith("partlycloudy"):
        return 2
    return next((c for k, c in MET if k in sym), 3)


def _open_meteo(lat: float, lon: float) -> dict | None:
    try:
        r = httpx.get("https://api.open-meteo.com/v1/forecast", headers=UA, timeout=httpx.Timeout(6, connect=3), params={
            "latitude": lat, "longitude": lon, "timezone": "auto", "forecast_days": 3, "current": "temperature_2m",
            "hourly": "temperature_2m,weather_code,precipitation_probability",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
        js = r.json() if r.status_code == 200 else None
        h, dl = js["hourly"], js["daily"]
    except Exception:  # noqa: BLE001
        return None
    hours = [{"t": t_, "code": int(c or 0), "temp": tp, "rain": pr, "mm": None}
             for t_, tp, c, pr in zip(h["time"], h["temperature_2m"], h["weather_code"], h["precipitation_probability"])]
    days = {d: {"code": int(c or 0), "hi": hi, "lo": lo, "rain": pr, "mm": None}
            for d, c, hi, lo, pr in zip(dl["time"], dl["weather_code"], dl["temperature_2m_max"], dl["temperature_2m_min"],
                                        dl["precipitation_probability_max"])}
    return {"hours": hours, "days": days, "now": (js.get("current") or {}).get("temperature_2m")}


def _met_no(lat: float, lon: float) -> dict | None:
    """備用：挪威氣象局（MET Norway），不用金鑰。台灣沒有降雨機率，改給雨量。"""
    from datetime import datetime
    try:
        r = httpx.get("https://api.met.no/weatherapi/locationforecast/2.0/complete", headers=UA,
                      timeout=httpx.Timeout(10, connect=4), params={"lat": round(lat, 3), "lon": round(lon, 3)})
        ts = (r.json() if r.status_code == 200 else None)["properties"]["timeseries"]
    except Exception:  # noqa: BLE001
        return None
    hours = []
    for x in ts:
        n1 = x["data"].get("next_1_hours")
        if not n1:                              # 後面的資料變成每 6 小時一筆，首頁用不到
            break
        t_ = datetime.fromisoformat(x["time"].replace("Z", "+00:00")).astimezone()
        det = n1.get("details", {})
        hours.append({"t": t_.strftime("%Y-%m-%dT%H:%M"), "code": _met_code(n1["summary"]["symbol_code"]),
                      "temp": x["data"]["instant"]["details"].get("air_temperature"),
                      "rain": det.get("probability_of_precipitation"), "mm": det.get("precipitation_amount")})
    days: dict = {}
    for h in hours:
        days.setdefault(h["t"][:10], []).append(h)
    out = {}
    for d, hs in days.items():
        temps = [h["temp"] for h in hs if h["temp"] is not None]
        probs = [h["rain"] for h in hs if h["rain"] is not None]
        noon = next((h for h in hs if h["t"][11:13] == "12"), None) or max(hs, key=lambda h: [x["code"] for x in hs].count(h["code"]))
        out[d] = {"code": noon["code"], "hi": max(temps), "lo": min(temps), "rain": max(probs) if probs else None,
                  "mm": round(sum(h["mm"] or 0 for h in hs), 1)}
    return {"hours": hours, "days": out, "now": hours[0]["temp"] if hours else None}


def _data() -> dict | None:
    """所在地接下來幾天的天氣（兩個服務擇一），半小時內用快取；都連不上就沿用上次的。"""
    p = place()
    if not p.get("geo") or OFFLINE:
        return None
    try:
        old = json.loads(db.kv_get("wx:raw") or "null")
    except ValueError:
        old = None
    if old and old.get("geo") != p["geo"]:
        old = None
    if old and time.time() - old["ts"] < FRESH:
        return old["data"]
    if time.time() - float(db.kv_get("wx:fail") or 0) < FAIL_WAIT:
        return old["data"] if old else None
    lat, lon = p["geo"]
    data = _open_meteo(lat, lon) or _met_no(lat, lon)
    if not data:
        db.kv_set("wx:fail", str(time.time()))
        return old["data"] if old else None
    db.kv_set("wx:fail", "")
    db.kv_set("wx:raw", json.dumps({"ts": time.time(), "geo": p["geo"], "data": data}))
    return data


def forecast(d: str) -> dict | None:
    """某天的天氣：{icon, text, hi, lo, rain, mm, now}；沒設所在地或查不到就回傳 None。"""
    from datetime import date as _date
    data = _data()
    day = (data or {}).get("days", {}).get(d)
    if not day or day["hi"] is None:
        return None
    icon, text = _desc(day["code"])
    now = data.get("now") if d == _date.today().isoformat() else None
    return {"icon": icon, "text": text, "hi": round(day["hi"]), "lo": round(day["lo"]), "rain": day["rain"],
            "mm": day.get("mm"), "now": round(now) if now is not None else None}


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
    elif w.get("mm"):
        s += tr("，預計雨量 {mm} 毫米", mm=w["mm"])
        if w["mm"] >= 1:
            s += tr("，記得帶傘 ☂️")
    return s


def hourly() -> list[dict]:
    """從現在這個小時開始，接下來 24 小時每小時的天氣（首頁用）。"""
    from datetime import datetime
    data = _data()
    if not data:
        return []
    cut = datetime.now().strftime("%Y-%m-%dT%H:00")
    out = []
    for h in data["hours"]:
        if h["t"] < cut or h["temp"] is None:
            continue
        icon, text = _desc(h["code"])
        out.append({"time": h["t"][11:16], "date": h["t"][:10], "icon": icon, "text": text,
                    "temp": round(h["temp"]), "rain": h["rain"], "mm": h.get("mm")})
        if len(out) == 24:
            break
    return out
