# Asa

**Self-hosted alarms that plan themselves.** Asa looks at tomorrow's schedule every evening and sets a whole batch of wake-up alarms for you — earlier when your first event is earlier, none when you have the day off. A calendar, daily/weekly to-dos and a review inbox for things pulled from other systems are built in.

> English / 繁體中文 UI, light and dark themes. 中文說明：[README.zh-TW.md](README.zh-TW.md)

## Features

- **Auto alarms** — rules like "weekdays: start 90 min before the first event, 8 alarms, 5 min apart". Re-planned whenever your schedule changes.
- **Android companion app** — rings on its own (no internet needed once synced), full-screen on the lock screen, rising volume, a maths question before "I'm up", reports wake-up times back.
- **Habit learning** — after a few mornings it suggests rule changes ("you sleep through the first 3, start later and ring more often").
- **Calendar** — day / week / month views, weekly recurring events, days off.
- **To-dos** — per day and per week, deadlines shown on the calendar, a 14-day load chart.
- **One-line input** (`Ctrl+K`) — `tomorrow 3pm meeting @room 5`, `report by fri`, `alarm tomorrow 7:30`, `every tue 9:10-12:00 calculus` (English or Chinese).
- **Looks** — animated aurora background, a colour per page, light/dark toggle, phone-friendly layout.
- **Review inbox** — sources drop items in; nothing reaches your calendar until you approve it.
  - iCalendar feeds (Google Calendar, Outlook, Moodle, Canvas, …)
  - eeClass LMS (used by many universities in Taiwan)
  - anything else: `POST /api/inbox`, or write a ~30-line plugin in `app/sources/`
- **Notifications** — Discord, LINE, Telegram, ntfy, or any webhook: evening preview, morning brief, new inbox items.

## Quick start

Needs Python 3.11+.

```bash
git clone <this repo> && cd asa
cp .env.example .env      # optional — everything works with an empty .env
./run.sh                  # Windows: run.bat
```

Open <http://localhost:8787>. The first start creates the virtualenv, the database (`data/asa.db`) and an access code for other devices (`PHONE_TOKEN` in `.env`).

Requests from the same machine are trusted; every other device must send the access code (`?token=…` once in the browser, or the `X-Token` header). Don't expose the port to the public internet — use your LAN or a private network such as Tailscale.

## Android app

Source is in `android/` (Kotlin, no third-party dependencies, minSdk 26). Build with Android Studio, or on Windows run `android\build_apk.bat`, which downloads a JDK, Gradle and the Android SDK into a separate folder and produces `android/AsaAlarm.apk`. Then enter the server URL and access code shown on the Settings page.

## Configuration

Everything lives in `.env` — see [.env.example](.env.example). Restart after changing it.

## Adding a source or a notification channel

- **Source**: add a module to `app/sources/` exposing `NAME`, `LABEL`, `ENV`, `configured()` and `collect()`, and list it in `app/sources/__init__.py` (the docstring there describes the item format).
- **Language**: UI strings are in `app/static/i18n.js`, server strings in `app/i18n.py` (set `ASA_LANG` for push messages).
- **Channel**: add a function and one line to `CHANNELS` in `app/notify.py`.

## Stack

FastAPI · SQLite · APScheduler · vanilla JS/CSS (no build step).

## Status

Early. The eeClass source and the Android app have not been verified end-to-end yet, and the Android app is Chinese-only for now — issues and PRs welcome.

## Credits

The aurora background and glowing card border are ported from [React Bits](https://reactbits.dev) by David Haz (MIT + Commons Clause); see `app/static/vendor/`. The checkbox is modelled on its SpringCheck. The sun/moon toggle is adapted from Adam Argyle's Theme Switch (GUI Challenges, Apache-2.0); the circular reveal follows Magic UI's Animated Theme Toggler (MIT).

## License

MIT — see [LICENSE](LICENSE). Bundled third-party pieces keep their own licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
