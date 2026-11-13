# Start Asa automatically when Windows boots, in the background, before anyone logs in.
# Usage: install_autostart.bat / uninstall_autostart.bat (they call this script).
param([string]$Action = "install", [string]$User = "", [switch]$DryRun)
$ErrorActionPreference = "Stop"
$name = "Asa"
$root = $PSScriptRoot
if (-not $User) { $User = [Security.Principal.WindowsIdentity]::GetCurrent().Name }

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $DryRun) {
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
        $act = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$root\run.bat`"`"" -WorkingDirectory $root
        $trg = New-ScheduledTaskTrigger -AtStartup
        $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
            -MultipleInstances IgnoreNew
        # S4U: runs as you without storing your password, whether or not you are logged in.
        $pri = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
        if ($DryRun) { Write-Host "Dry run OK: $($act.Execute) $($act.Arguments) as $($pri.LogonType)"; exit }
        Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $pri -Force | Out-Null

        # The older version of this script used a shortcut in the Startup folder: remove it.
        foreach ($old in "Asa.lnk", "LifeHub.lnk") {
            Remove-Item (Join-Path ([Environment]::GetFolderPath("Startup")) $old) -ErrorAction SilentlyContinue
        }
        Start-ScheduledTask -TaskName $name
        Write-Host "Done. Asa now starts in the background whenever this PC boots, and it has been started now."
        Write-Host "To undo: run uninstall_autostart.bat"
    }
} catch {
    Write-Host "Failed: $_" -ForegroundColor Red
}
Read-Host "Press Enter to close"
