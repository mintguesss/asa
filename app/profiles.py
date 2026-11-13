"""成員（個人檔案）：讓兩三個人共用同一台 Asa，但鬧鐘、待辦、通知各管各的。

- 不是帳號系統：沒有密碼和註冊，每個人只有一組自己的存取碼。
- 只有一個人用的時候，這裡的東西完全不會出現在介面上。
- 第一位成員的資料在 data/asa.db；之後每位成員各有自己的資料庫檔（data/asa-2.db…），
  所以私人資料天生就是分開的。行程和待辦可以標成「一起的」，才會出現在其他人那邊。
- 成員名單存在第一位成員的資料庫裡。
"""
import hmac
import json
import os
import secrets
import time

from . import db

FIELDS = ["name", "color", "alarm_mode", "remind_minutes", "visible", "lang"]
ALARM_MODES = ("app", "notify", "off")      # App 鬧鐘 / 用推播叫 / 不需要
VISIBLE = ("full", "busy", "none")          # 其他成員看我的行程：細節 / 只顯示有事 / 看不到
COLORS = ["#7c5cff", "#ff7a9c", "#38e1ff", "#ffc46b", "#7cff9b"]


def _load(r: dict) -> dict:
    r["notify"] = json.loads(r.get("notify") or "{}")
    return r


def all() -> list[dict]:  # noqa: A001
    with db.as_profile(1):
        return [_load(r) for r in db.rows("SELECT * FROM profiles ORDER BY id")]


def ensure(default_name: str) -> None:
    """第一次啟動：建立第一位成員。"""
    with db.as_profile(1):
        if not db.one("SELECT 1 FROM profiles WHERE id = 1"):
            db.insert("profiles", {"id": 1, "name": default_name, "color": COLORS[0]})
    for p in all():
        with db.as_profile(p["id"]):
            db.init_one()


def get(pid: int) -> dict | None:
    return next((p for p in all() if p["id"] == int(pid)), None)


def current() -> dict:
    return get(db.me()) or {"id": db.me(), "name": "", "color": COLORS[0], "alarm_mode": "app",
                            "remind_minutes": 0, "visible": "busy", "lang": None, "notify": {}, "token": None}


def others() -> list[dict]:
    return [p for p in all() if p["id"] != db.me()]


def multi() -> bool:
    return len(all()) > 1


def token_of(p: dict) -> str:
    """第一位成員的存取碼沿用 .env 的 PHONE_TOKEN，其他人的存在名單裡。"""
    return os.environ.get("PHONE_TOKEN", "") if p["id"] == 1 else (p.get("token") or "")


def by_token(given: str) -> dict | None:
    if not given:
        return None
    for p in all():
        tok = token_of(p)
        if tok and hmac.compare_digest(given.encode(), tok.encode()):
            return p
    return None


def create(name: str) -> dict:
    with db.as_profile(1):
        n = db.one("SELECT COUNT(*) n FROM profiles")["n"]
        pid = db.insert("profiles", {
            "name": name.strip() or f"#{n + 1}", "color": COLORS[n % len(COLORS)],
            "token": "-".join(secrets.token_hex(2) for _ in range(3)),
            "alarm_mode": "off", "remind_minutes": 30})
    with db.as_profile(pid):
        db.init_one()
    return get(pid)


def update(pid: int, data: dict) -> None:
    patch = {k: data[k] for k in FIELDS if k in data}
    if patch.get("alarm_mode") not in (None, *ALARM_MODES) or patch.get("visible") not in (None, *VISIBLE):
        raise ValueError("bad value")
    if "remind_minutes" in patch:
        patch["remind_minutes"] = max(0, min(720, int(patch["remind_minutes"] or 0)))
    if "notify" in data:                        # 只改有送來的欄位；空字串 = 清掉
        cur = (get(pid) or {}).get("notify", {})
        for k, v in data["notify"].items():
            if str(v).strip():
                cur[k] = str(v).strip()
            else:
                cur.pop(k, None)
        patch["notify"] = json.dumps(cur)
    with db.as_profile(1):
        db.update("profiles", int(pid), patch)


def delete(pid: int) -> None:
    """移除成員。資料庫檔不刪，改名留著，萬一後悔還救得回來。"""
    pid = int(pid)
    if pid == 1 or not get(pid):
        raise ValueError("cannot delete")
    with db.as_profile(1):
        db.run("DELETE FROM profiles WHERE id = ?", (pid,))
    f = db.path(pid)
    try:
        if f.exists():
            f.rename(f.with_name(f"{f.stem}.removed-{int(time.time())}{f.suffix}"))
    except OSError:                             # 檔案被佔住就留在原地，反正已經不在名單裡
        pass


AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def avatar_dir():
    return db.DB_PATH.parent / f"{db.DB_PATH.stem}-avatars"     # data/asa-avatars；示範模式用 demo-avatars


def avatar_file(pid: int):
    for ext in AVATAR_TYPES.values():
        f = avatar_dir() / f"{int(pid)}.{ext}"
        if f.exists():
            return f
    return None


def avatar_url(p: dict) -> str | None:
    return f"/api/avatar/{p['id']}?v={p['avatar']}" if p.get("avatar") and avatar_file(p["id"]) else None


def set_avatar(pid: int, mime: str, data: bytes) -> None:
    """存頭貼。前端已經裁成小方圖，這裡只檢查類型和大小。"""
    if mime not in AVATAR_TYPES or not data or len(data) > 600_000:
        raise ValueError("bad image")
    avatar_dir().mkdir(parents=True, exist_ok=True)
    old = avatar_file(pid)
    if old:
        old.unlink()
    (avatar_dir() / f"{int(pid)}.{AVATAR_TYPES[mime]}").write_bytes(data)
    with db.as_profile(1):
        db.update("profiles", int(pid), {"avatar": str(int(time.time()))})


def clear_avatar(pid: int) -> None:
    old = avatar_file(pid)
    if old:
        old.unlink()
    with db.as_profile(1):
        db.update("profiles", int(pid), {"avatar": None})


def each():
    """依序切到每位成員：for p in profiles.each(): …（排程工作用）。"""
    for p in all():
        with db.as_profile(p["id"]):
            yield p
