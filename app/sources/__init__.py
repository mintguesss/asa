"""資料來源外掛：每個模組負責從一個外部系統抓資料，丟進待審核佇列。

要新增一個來源，在這個資料夾放一個模組，提供：

    NAME  = "myschool"            # 唯一代號（英數）
    LABEL = "My School LMS"       # 顯示在設定頁的名稱
    ENV   = ["MYSCHOOL_TOKEN"]    # 需要在 .env 填的變數（顯示用）

    def configured() -> bool: ...          # 設定填好了嗎（用 conf.get(key) 讀，每位成員各一份）
    def collect() -> list[dict]: ...       # 回傳項目清單

每個項目是一個 dict：
    ext_id   來源端的唯一識別（必填，用來去重複）
    kind     homework / exam / announcement / event / other
    title    標題
    course   分類（課名、行事曆名稱…，可空）
    due      截止或開始時間 "YYYY-MM-DDTHH:MM"（可空）
    end      結束時間（kind=event 時用，可空）
    location 地點（可空）
    link     原始頁面網址（可空）
    body     內文摘要（可空）
    source   填 NAME

然後把模組加進下面的 ALL。不想寫外掛的話，也可以直接 POST 同樣格式的 JSON 到 /api/inbox。
"""
from . import eeclass, ics

ALL = [eeclass, ics]
BY_NAME = {m.NAME: m for m in ALL}
