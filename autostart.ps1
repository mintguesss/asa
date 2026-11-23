# Start Asa automatically when Windows boots, in the background, before anyone logs in.
# Usage: install_autostart.bat / uninstall_autostart.bat (they call this script).
# -Logon: start when you log in instead of at boot; needs no administrator rights (no UAC prompt).
# -Quiet: don't wait for Enter at the end.
param([string]$Action = "install", [string]$User = "", [switch]$DryRun, [switch]$Logon, [switch]$Quiet)
$ErrorActionPreference = "Stop"
$name = "Asa"
$root = $PSScriptRoot
if (-not $User) { $User = [Security.Principal.WindowsIdentity]::GetCurrent().Name }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $DryRun -and -not $Logon) {
    # Registering a boot-time task needs administrator rights: relaunch elevated (Windows will ask).
    Start-Process powershell -Verb RunAs -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"",
        "-Action", $Action, "-User", "`"$User`"")
    exit
}

try {
    if ($Action -eq "remove") {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed. Asa will no longer start with Windows."
        } else {
            Write-Host "Nothing to remove: the '$name' task does not exist."
        }
    } else {
        if (-not (Test-Path "$root\.venv\Scripts\pythonw.exe")) { throw "Run run.bat once first (it creates .venv)." }
        # pythonw: no console window; output goes to data\server.log (see run_hidden.pyw)
        $act = New-ScheduledTaskAction -Execute "$root\.venv\Scripts\pythonw.exe" -Argument "`"$root\run_hidden.pyw`"" -WorkingDirectory $root
        $trg = if ($Logon) { New-ScheduledTaskTrigger -AtLogOn -User $User } else { New-ScheduledTaskTrigger -AtStartup }
        $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
            -MultipleInstances IgnoreNew
        # S4U: runs as you without storing your password, whether or not you are logged in.
        # -Logon: runs in your own session after you log in, so no stored password and no admin rights.
        $pri = New-ScheduledTaskPrincipal -UserId $User -LogonType $(if ($Logon) { "Interactive" } else { "S4U" }) -RunLevel Limited
        if ($DryRun) { Write-Host "Dry run OK: $($act.Execute) $($act.Arguments) as $($pri.LogonType)"; exit }
        Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $pri -Force | Out-Null

        # The older version of this script used a shortcut in the Startup folder: remove it.
        foreach ($old in "Asa.lnk", "LifeHub.lnk") {
            Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) $old) -ErrorAction SilentlyContinue
        }
        Start-ScheduledTask -TaskName $name
        Write-Host "Done. Asa now starts in the background whenever $(if ($Logon) { 'you log in' } else { 'this PC boots' }), and it has been started now. Log: data\server.log"
        Write-Host "To undo: run uninstall_autostart.bat"
    }
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}
if (-not $Quiet) { Read-Host "Press Enter to close" }
