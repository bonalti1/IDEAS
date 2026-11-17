# Draft House office worker: install as a self-restarting scheduled task that survives a reboot.
# Run once, as Administrator, in PowerShell, from the worker folder:
#     Set-ExecutionPolicy -Scope Process Bypass -Force; .\install.ps1
#
# Why a scheduled task and not a Windows service: Revit needs an interactive desktop. A service runs
# in session 0 where Revit cannot show its window, so pyRevit cannot drive it. The task runs in the
# logged-on desktop session, starts at logon, restarts itself when it stops, and a watchdog task
# checks every 5 minutes that it is still running. With automatic logon (step 8 in INSTALL.md) the
# worker is back within a minute of a reboot without anyone touching the machine.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw 'python is not on PATH. Install Python 3.11+ from python.org with "Add to PATH".' }
if (-not (Get-Command pyrevit -ErrorAction SilentlyContinue)) { Write-Warning 'pyrevit CLI is not on PATH; the worker will report it and Revit builds will fail until it is installed.' }
if (-not (Test-Path (Join-Path $here 'config.json'))) { throw "config.json is missing in $here. Copy config.example.json and fill it in." }
$cfg = Get-Content (Join-Path $here 'config.json') | ConvertFrom-Json
if (-not $cfg.workerKey) { Write-Warning 'config.json has no workerKey; the office API will refuse the worker unless it runs open.' }
$user = "$env:USERDOMAIN\$env:USERNAME"
$script = Join-Path $here 'draft_house_worker.py'
$logDir = Join-Path $here 'work'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# the worker task: at logon of this user, restart on failure forever, never time out, no battery rules
$action = New-ScheduledTaskAction -Execute $python -Argument "`"$script`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'DraftHouseWorker' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Draft House Revit worker (restarts itself; see worker\INSTALL.md)' -Force | Out-Null

# the watchdog: every 5 minutes, start the worker task if its python process is gone
$watch = Join-Path $here 'watchdog.ps1'
$wAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watch`"" -WorkingDirectory $here
$wTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$wSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'DraftHouseWatchdog' -Action $wAction -Trigger $wTrigger -Settings $wSettings -Principal $principal -Description 'Restarts DraftHouseWorker when it is not running' -Force | Out-Null

# keep the machine awake: Revit builds take minutes and the worker must answer heartbeats
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null

Start-ScheduledTask -TaskName 'DraftHouseWorker'
Start-Sleep -Seconds 3
$running = Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $python }
Write-Host ''
Write-Host "Installed. Worker task: DraftHouseWorker (at logon of $user, restarts every minute if it stops). Watchdog: DraftHouseWatchdog (every 5 min)."
Write-Host "Worker log: $logDir\worker.log"
if ($running) { Write-Host 'The worker is running now. The dashboard should show this machine online within a minute.' } else { Write-Warning 'The worker did not start. Run: python draft_house_worker.py  by hand and read the error.' }
Write-Host 'Remaining step for a reboot-proof setup: automatic logon for this account (INSTALL.md step 8).'
