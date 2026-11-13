"""示範模式：設 ASA_DEMO=1 啟動，就會用獨立的 data/demo.db 並填入一週的範例資料。

每次啟動都重建（日期永遠相對於今天），不會碰到真正的 data/asa.db；
示範模式下也不會跑排程推播和資料來源同步。
"""
from datetime import date, timedelta

from . import core, db, i18n, profiles


def seed() -> None:
    en = i18n.default() == "en"

    def L(zh: str, e: str) -> str:
        return e if en else zh

    today = date.today()
    monday = today - timedelta(days=today.weekday())

    def day(n: int) -> str:
        return (today + timedelta(days=n)).isoformat()

    for wd, start, end, title, loc in [
        (0, "09:00", "10:50", L("線性代數", "Linear Algebra"), L("工程五館 A205", "Eng. Bldg 5 A205")),
        (0, "13:00", "14:50", L("計算機概論", "Intro to CS"), L("資電館 107", "CS Hall 107")),
        (1, "08:00", "09:50", L("微積分", "Calculus"), L("理學院 S-205", "Science S-205")),
        (1, "15:00", "16:50", L("英文", "English"), L("文學院 C2-209", "Arts C2-209")),
        (2, "10:00", "11:50", L("普通物理", "Physics"), L("理學院 S-116", "Science S-116")),
        (3, "08:00", "09:50", L("微積分", "Calculus"), L("理學院 S-205", "Science S-205")),
        (3, "13:00", "15:50", L("程式設計實習", "Programming Lab"), L("資電館 B1 電腦教室", "CS Hall B1 Lab")),
        (4, "09:00", "10:50", L("線性代數", "Linear Algebra"), L("工程五館 A205", "Eng. Bldg 5 A205")),
        (5, "11:00", "17:00", L("咖啡店打工", "Café shift"), L("校門口", "Main gate")),
    ]:
        db.insert("weekly_events", {"title": title, "weekday": wd, "start_time": start, "end_time": end, "location": loc})

    for n, start, end, title, loc in [
        (0, "19:00", "21:00", L("吉他社社課", "Guitar club"), L("活動中心 204", "Student Center 204")),
        (1, "12:10", "13:00", L("跟指導教授吃午餐", "Lunch with advisor"), L("松苑餐廳", "Pine Hall")),
        (2, "17:30", "18:15", L("牙醫回診", "Dentist"), ""),
        (4, "18:30", "20:00", L("專題小組討論", "Project meeting"), L("圖書館討論室 3", "Library room 3")),
        (6, "19:30", "22:00", L("演唱會", "Concert"), ""),
        (9, "09:00", "11:00", L("微積分期中考", "Calculus midterm"), L("理學院 S-205", "Science S-205")),
    ]:
        db.insert("events", {"title": title, "start": f"{day(n)}T{start}", "end": f"{day(n)}T{end}", "location": loc})

    for n, title, due, est, done in [
        (0, L("線性代數作業 4", "Linear Algebra HW 4"), f"{day(1)}T23:59", 90, 0),
        (0, L("洗衣服", "Laundry"), None, 30, 1),
        (0, L("回覆專題組員訊息", "Reply to project teammates"), None, 10, 1),
        (0, L("預習物理第 7 章", "Preview Physics ch. 7"), None, 45, 0),
        (1, L("英文口頭報告投影片", "English presentation slides"), f"{day(3)}T15:00", 120, 0),
        (2, L("繳電話費", "Pay phone bill"), f"{day(2)}T23:59", 5, 0),
        (3, L("程式設計實習：Lab 6", "Programming Lab 6"), f"{day(5)}T23:59", 150, 0),
    ]:
        db.insert("tasks", {"title": title, "scope": "day", "plan_date": day(n), "due": due, "est_minutes": est,
                            "done": done, "done_at": f"{day(0)} 10:00:00" if done else None})
    for title, done in [(L("運動三次", "Work out 3 times"), 0), (L("讀完微積分第 5 章", "Finish Calculus ch. 5"), 0),
                        (L("整理房間", "Tidy my room"), 1)]:
        db.insert("tasks", {"title": title, "scope": "week", "plan_date": monday.isoformat(), "done": done,
                            "done_at": f"{day(0)} 10:00:00" if done else None})

    db.insert("inbox", {"ext_id": "demo-1", "kind": "homework", "course": L("普通物理", "Physics"),
                        "title": L("第 6 章習題", "Chapter 6 problem set"), "due": f"{day(5)}T23:59", "source": "eeclass"})
    db.insert("inbox", {"ext_id": "demo-2", "kind": "announcement", "course": L("計算機概論", "Intro to CS"),
                        "title": L("下週一停課一次", "No class next Monday"), "source": "eeclass",
                        "body": L("老師出國開會，下週一停課，補課時間另行公告。", "The lecturer is away; a make-up class will be announced.")})
    db.insert("inbox", {"ext_id": "demo-3", "kind": "event", "course": L("個人", "Personal"),
                        "title": L("家庭聚餐", "Family dinner"), "due": f"{day(7)}T18:00", "end": f"{day(7)}T20:00",
                        "location": L("老家", "Home"), "source": "ics"})

    db.run("INSERT OR IGNORE INTO skip_dates (date, reason) VALUES (?, ?)", (day(12), L("校慶補假", "School holiday")))

    # 過去一週的起床紀錄：讓「習慣建議」有東西可以看
    for n in range(-7, 0):
        d = day(n)
        core.regenerate_plan(d)
        alarms = core.plan(d)
        if alarms:
            h, m = map(int, alarms[0]["time"].split(":"))
            late = h * 60 + m + 35 + (n % 3) * 5
            db.insert("alarm_log", {"date": d, "time": alarms[-1]["time"], "action": "awake",
                                    "ts": f"{d} {late // 60:02d}:{late % 60:02d}:00"})
    # 第二位成員：示範「跟另一半共用」——她用 iPhone，不排鬧鐘，改用行程前推播提醒
    db.update("events", db.one("SELECT id FROM events WHERE start LIKE ?", (f"{day(6)}%",))["id"], {"shared": 1})
    db.insert("tasks", {"title": L("買衛生紙和洗衣精", "Toilet paper & detergent"), "scope": "week",
                        "plan_date": monday.isoformat(), "shared": 1})
    other = profiles.create(L("小美", "Mia"))
    profiles.update(other["id"], {"visible": "full", "remind_minutes": 30})
    with db.as_profile(other["id"]):
        for wd, start, end, title in [(0, "09:00", "18:00", L("上班", "Work")), (1, "09:00", "18:00", L("上班", "Work")),
                                      (2, "09:00", "18:00", L("上班", "Work")), (3, "09:00", "18:00", L("上班", "Work")),
                                      (4, "09:00", "17:00", L("上班", "Work")), (2, "19:30", "21:00", L("瑜珈課", "Yoga"))]:
            db.insert("weekly_events", {"title": title, "weekday": wd, "start_time": start, "end_time": end, "wake": 0})
        db.insert("events", {"title": L("一起吃早午餐", "Brunch together"), "start": f"{day(1)}T10:30",
                             "end": f"{day(1)}T12:00", "location": L("巷口早午餐", "The corner café"), "shared": 1})
        db.insert("events", {"title": L("看電影", "Movie night"), "start": f"{day(3)}T20:10",
                             "end": f"{day(3)}T22:30", "location": L("威秀影城", "Cinema"), "shared": 1})
        db.insert("tasks", {"title": L("訂週末餐廳", "Book a restaurant for the weekend"), "scope": "day",
                            "plan_date": day(0), "shared": 1})
        db.insert("tasks", {"title": L("寄生日卡給阿嬤", "Send grandma a birthday card"), "scope": "day", "plan_date": day(0)})

    for n in range(0, 14):
        core.regenerate_plan(day(n))
