"""SQLite 資料層：所有資料都存在 data/asa.db。"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "asa.db"

# 專案原名 LifeHub：第一次啟動時把舊資料庫改成新檔名
for _suffix in ("", "-wal", "-shm"):
    _old = DB_PATH.with_name("lifehub.db" + _suffix)
    _new = DB_PATH.with_name("asa.db" + _suffix)
    if _old.exists() and not _new.exists():
        _old.rename(_new)

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    start TEXT NOT NULL,            -- YYYY-MM-DDTHH:MM
    end TEXT,
    location TEXT DEFAULT '',
    note TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',   -- manual / 來源外掛的 NAME
    wake INTEGER DEFAULT 1          -- 是否作為鬧鐘的基準行程
);
CREATE TABLE IF NOT EXISTS weekly_events (   -- 每週固定行程（課表、班表…）
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    weekday INTEGER NOT NULL,       -- 0=週一 … 6=週日
    start_time TEXT NOT NULL,       -- HH:MM
    end_time TEXT,
    location TEXT DEFAULT '',
    wake INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS skip_dates (      -- 放假：當天的固定行程不算
    date TEXT PRIMARY KEY,
    reason TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    scope TEXT DEFAULT 'day',       -- day / week
    plan_date TEXT,                 -- 預計哪天做（week 則為該週週一）
    due TEXT,                       -- 截止 YYYY-MM-DDTHH:MM
    est_minutes INTEGER,
    done INTEGER DEFAULT 0,
    done_at TEXT,
    link TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    created TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS inbox (           -- 待審核佇列
    id INTEGER PRIMARY KEY,
    ext_id TEXT UNIQUE,             -- 來源端的唯一識別，避免重複
    kind TEXT NOT NULL,             -- homework / announcement / exam / event / other
    title TEXT NOT NULL,
    course TEXT DEFAULT '',         -- 分類：課名、行事曆名稱…
    due TEXT,                       -- 截止時間；kind=event 時是開始時間
    end TEXT,
    location TEXT DEFAULT '',
    link TEXT DEFAULT '',
    body TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'pending',  -- pending / approved / rejected
    created TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS alarm_rules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    weekdays TEXT NOT NULL,         -- 例 "0,1,2,3,4"
    anchor TEXT DEFAULT 'first_event',  -- first_event / fixed
    lead_minutes INTEGER DEFAULT 90,    -- 第一個鬧鐘在第一個行程前幾分鐘
    fixed_time TEXT,                -- anchor=fixed 的起始時間；或沒行程時的備用時間（可空）
    count INTEGER DEFAULT 6,
    interval_minutes INTEGER DEFAULT 5,
    enabled INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS alarm_plan (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT NOT NULL,             -- HH:MM
    label TEXT DEFAULT '',
    source TEXT DEFAULT 'auto',     -- auto / manual
    enabled INTEGER DEFAULT 1,
    UNIQUE(date, time)
);
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS alarm_log (       -- 手機回報，之後用來學習起床習慣
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT,
    action TEXT NOT NULL,           -- fired / dismissed / snoozed / awake
    ts TEXT DEFAULT (datetime('now','localtime'))
);
"""


def conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(exist_ok=True)
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
        # 舊資料庫升級：補上後來才加的欄位
        have = {r["name"] for r in c.execute("PRAGMA table_info(inbox)")}
        for col, ddl in (("end", "TEXT"), ("location", "TEXT DEFAULT ''")):
            if col not in have:
                c.execute(f'ALTER TABLE inbox ADD COLUMN "{col}" {ddl}')


def rows(sql: str, args: tuple = ()) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def one(sql: str, args: tuple = ()) -> dict | None:
    r = rows(sql, args)
    return r[0] if r else None


def run(sql: str, args: tuple = ()) -> int:
    """執行寫入，回傳 lastrowid。"""
    with conn() as c:
        return c.execute(sql, args).lastrowid


def insert(table: str, data: dict) -> int:
    cols = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    return run(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(data.values()))


def update(table: str, id_: int, data: dict) -> None:
    if not data:
        return
    sets = ", ".join(f"{k} = ?" for k in data)
    run(f"UPDATE {table} SET {sets} WHERE id = ?", (*data.values(), id_))


def kv_get(key: str, default: str | None = None) -> str | None:
    r = one("SELECT value FROM kv WHERE key = ?", (key,))
    return r["value"] if r else default


def kv_set(key: str, value: str) -> None:
    run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", (key, value))
