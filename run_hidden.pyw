# 給開機自動執行用：不開視窗在背景跑 Asa，輸出寫到 data/server.log。
# 由 autostart.ps1 建立的排程呼叫（.venv\Scripts\pythonw.exe run_hidden.pyw）；手動啟動請用 run.bat。
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
os.chdir(root)
sys.path.insert(0, str(root))

log_path = root / "data" / "server.log"
log_path.parent.mkdir(exist_ok=True)
if log_path.exists() and log_path.stat().st_size > 5_000_000:      # 超過 5 MB 就換一個新檔
    log_path.replace(log_path.with_suffix(".old.log"))
sys.stdout = sys.stderr = open(log_path, "a", encoding="utf-8", buffering=1)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(root / ".env")

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8787")))
