@echo off
cd /d "%~dp0"
if not exist .venv (
  py -m venv .venv || python -m venv .venv
  .venv\Scripts\python -m pip install -r requirements.txt
)
if "%PORT%"=="" set PORT=8787
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%
