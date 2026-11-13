"""行程留言和動態（像 TimeTree）：只有多位成員時才有意義。

- 留言存在「行程主人」的資料庫（comments 表），所以留言跟著行程走，刪行程時一起刪。
- 動態存在第一位成員的資料庫（activity 表），所有人共用一份；每個人看過到哪一筆記在自己的 kv。
- 只記錄別人看得到的東西：一起的行程、共用待辦、留言。私人行程不會出現在動態裡。
"""
from . import db, notify, profiles
from .i18n import tr

ACTIONS = ("event_add", "event_del", "task_add", "task_done", "comment")


def comment_counts(ids: list[int]) -> dict[int, int]:
    """目前資料庫裡這些行程各有幾則留言。"""
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    return {r["event_id"]: r["n"] for r in db.rows(
        f"SELECT event_id, COUNT(*) n FROM comments WHERE event_id IN ({marks}) GROUP BY event_id", tuple(ids))}


def comments(event_id: int) -> list[dict]:
    out = db.rows("SELECT * FROM comments WHERE event_id = ? ORDER BY id", (event_id,))
    people = {p["id"]: p for p in profiles.all()}
    for c in out:
        p = people.get(c["author"]) or {"id": c["author"], "name": "?", "color": "#888"}
        c |= {"author_name": p["name"], "author_color": p["color"], "avatar": profiles.avatar_url(p)}
    return out


def log(action: str, title: str, owner: int, ref_id: int | None, body: str = "", push: bool = False) -> None:
    """記一筆動態；push=True 時也推播給其他成員（用他們各自的通知管道和語言）。"""
    if not profiles.multi():
        return
    actor = db.me()
    with db.as_profile(1):
        db.insert("activity", {"actor": actor, "action": action, "title": title[:200], "owner": owner,
                               "ref_id": ref_id, "body": body[:300]})
    if not push:
        return
    me = profiles.get(actor) or {"name": "?"}
    from . import i18n
    for p in profiles.others():
        with db.as_profile(p["id"]):
            i18n.set_lang(p.get("lang"))
            text = tr("💬 {who} 在「{title}」留言：{body}", who=me["name"], title=title, body=body) if action == "comment" \
                else tr("📅 {who} 新增了一起的行程：{title}", who=me["name"], title=title)
            try:
                notify.send(text)
            except Exception:  # noqa: BLE001  推播失敗不影響操作本身
                pass
    i18n.set_lang(None)


def feed(limit: int = 60) -> list[dict]:
    with db.as_profile(1):
        rows = db.rows("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,))
    people = {p["id"]: p for p in profiles.all()}
    for r in rows:
        p = people.get(r["actor"]) or {"id": r["actor"], "name": "?", "color": "#888"}
        r |= {"actor_name": p["name"], "actor_color": p["color"], "avatar": profiles.avatar_url(p),
              "mine": r["actor"] == db.me()}
    return rows


def unread() -> int:
    seen = int(db.kv_get("activity_seen", "0") or 0)
    me = db.me()                                # 先記下是誰，下面會切到第一位成員的資料庫
    with db.as_profile(1):
        return db.one("SELECT COUNT(*) n FROM activity WHERE id > ? AND actor != ?", (seen, me))["n"]


def mark_seen() -> None:
    with db.as_profile(1):
        top = db.one("SELECT MAX(id) m FROM activity")["m"] or 0
    db.kv_set("activity_seen", str(top))
