"""通知管道。沒設定的管道會自動略過；要加新管道，寫一個函式再登記到 CHANNELS 即可。"""
import os

import httpx

from . import db, profiles


def _env(*keys: str) -> list[str]:
    """目前這位成員的設定值：自己在設定頁填的優先；第一位成員沒填的話用 .env。"""
    own = profiles.current()["notify"]
    return [str(own.get(k) or (os.getenv(k, "") if db.me() == 1 else "")).strip() for k in keys]


def _discord(text: str, hook: str):
    return httpx.post(hook, json={"content": text[:1990]}, timeout=15)


def _line(text: str, token: str, to: str):
    return httpx.post("https://api.line.me/v2/bot/message/push",
                      headers={"Authorization": f"Bearer {token}"},
                      json={"to": to, "messages": [{"type": "text", "text": text[:4900]}]}, timeout=15)


def _telegram(text: str, token: str, chat: str):
    return httpx.post(f"https://api.telegram.org/bot{token}/sendMessage",
                      json={"chat_id": chat, "text": text[:4000]}, timeout=15)


def _ntfy(text: str, url: str):
    return httpx.post(url, content=text.encode(), timeout=15)


def _webhook(text: str, url: str):
    return httpx.post(url, json={"text": text}, timeout=15)


# 代號: (顯示名稱, 需要的 .env 變數, 發送函式)
CHANNELS = {
    "discord": ("Discord", ("DISCORD_WEBHOOK_URL",), _discord),
    "line": ("LINE", ("LINE_CHANNEL_ACCESS_TOKEN", "LINE_USER_ID"), _line),
    "telegram": ("Telegram", ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"), _telegram),
    "ntfy": ("ntfy", ("NTFY_URL",), _ntfy),
    "webhook": ("自訂 Webhook", ("WEBHOOK_URL",), _webhook),
}


def channels() -> list[dict]:
    return [{"name": k, "label": label, "env": list(keys), "configured": all(_env(*keys))}
            for k, (label, keys, _) in CHANNELS.items()]


def send(text: str) -> dict:
    """送到所有已設定的管道，回傳 {代號: "ok" / "未設定" / 錯誤訊息}。"""
    result = {}
    for name, (_, keys, fn) in CHANNELS.items():
        vals = _env(*keys)
        if not all(vals):
            result[name] = "未設定"
            continue
        try:
            r = fn(text, *vals)
            result[name] = "ok" if r.status_code < 300 else f"失敗 {r.status_code}: {r.text[:200]}"
        except Exception as e:  # noqa: BLE001
            result[name] = f"失敗: {e}"
    return result
