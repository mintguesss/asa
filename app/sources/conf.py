"""資料來源的設定（學校帳密、行事曆網址…），每位成員各一份。

- 存在那位成員自己的資料庫（kv 表的 src_cfg），所以兩個人可以各接各的學校帳號。
- 第一位成員沒填的欄位會沿用 .env，舊的設定方式照樣能用。
- 不是密碼的欄位（例如學校網址）其他成員沒填時也沿用 .env，同校就不用再填一次。
"""
import json
import os

from .. import db

SECRET = ("PASSWORD", "TOKEN", "SECRET", "_URLS")   # 這些欄位不回傳給網頁、也不分享給其他成員


def secret(key: str) -> bool:
    return any(s in key for s in SECRET)


def _own() -> dict:
    try:
        return json.loads(db.kv_get("src_cfg") or "{}")
    except ValueError:
        return {}


def get(key: str) -> str:
    v = str(_own().get(key) or "")
    if v.strip():
        return v if "PASSWORD" in key else v.strip()
    if db.me() == 1 or not secret(key) and not key.endswith("_ACCOUNT"):
        return os.getenv(key, "") if "PASSWORD" in key else os.getenv(key, "").strip()
    return ""


def save(keys: list[str], values: dict) -> None:
    """留空 = 不變；只填空白 = 清掉這一欄。"""
    cur = _own()
    for k in keys:
        if k not in values:
            continue
        v = str(values[k] or "")
        if v.strip():
            cur[k] = v if "PASSWORD" in k else v.strip()
        elif v:
            cur.pop(k, None)
    db.kv_set("src_cfg", json.dumps(cur, ensure_ascii=False))


def view(keys: list[str]) -> list[dict]:
    """給設定頁看的：哪些欄位填了；不是密碼的才把內容一起給。"""
    own = _own()
    out = []
    for k in keys:
        mine = str(own.get(k) or "").strip()
        val = get(k)
        out.append({"key": k, "secret": secret(k), "set": bool(val), "own": bool(mine),
                    "value": "" if secret(k) else val})
    return out
