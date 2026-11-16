# Every 5 minutes (scheduled task DraftHouseWatchdog): if no python process is running the worker, start the worker task.
# Also kills a Revit left behind by a crashed build older than 30 minutes, so the next job can launch it.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'work\watchdog.log'
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$worker = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*draft_house_worker.py*' }
if (-not $worker) {
  Start-ScheduledTask -TaskName 'DraftHouseWorker'
  Add-Content $log "$stamp worker was not running; started DraftHouseWorker"
}
$old = Get-Process Revit -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -lt (Get-Date).AddMinutes(-30) }
if ($old -and -not $worker) {
  $old | Stop-Process -Force
  Add-Content $log "$stamp killed a Revit older than 30 minutes with no worker running"
}
