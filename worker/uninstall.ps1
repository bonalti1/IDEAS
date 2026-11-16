# Removes the Draft House scheduled tasks. Run as Administrator.
Unregister-ScheduledTask -TaskName 'DraftHouseWorker' -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'DraftHouseWatchdog' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*draft_house_worker.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Draft House worker tasks removed.'
