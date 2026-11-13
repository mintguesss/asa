@echo off
set "T=%~dp0run.bat"
set "L=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Asa.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:L);$s.TargetPath=$env:T;$s.WorkingDirectory=(Split-Path $env:T);$s.WindowStyle=7;$s.Save()"
echo Done: %L%
pause
