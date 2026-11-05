<#
edge-reaper.ps1 - stop orphan headless browsers that test scripts left behind.

Targets: root processes of msedge.exe, chrome.exe, chrome-headless-shell.exe
  - command line has --headless
  - --user-data-dir is under %TEMP% (throwaway profile)
  - older than -MaxAgeHours (default 8)
Skip: profile folder has a file named .keep-alive
Action: taskkill /T /F on the root, then delete the temp profile folder.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File edge-reaper.ps1 [-MaxAgeHours 8] [-DryRun]
Scheduled task "pi-edge-reaper" runs it each hour (see -Install / -Uninstall).
Convention for detached browsers: profile prefix "pi-edge-<task>-" under %TEMP%.
#>
param(
  [double]$MaxAgeHours = 8,
  [switch]$DryRun,
  [switch]$Install,
  [switch]$Uninstall
)

$TaskName = 'pi-edge-reaper'
$LogDir = Join-Path $env:USERPROFILE '.pi\agent\logs'
$Log = Join-Path $LogDir 'edge-reaper.log'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  "removed task $TaskName"
  return
}

if ($Install) {
  $ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arg = "--headless `"$ps`" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -MaxAgeHours $MaxAgeHours"
  $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Stop orphan headless browsers with temp profiles (pi)' -Force | Out-Null
  "installed task $TaskName (hourly, MaxAgeHours=$MaxAgeHours)"
  return
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
function Write-Log($msg) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  $line
  if (-not $DryRun) { Add-Content -Path $Log -Value $line }
}

$temp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')
$names = @('msedge.exe', 'chrome.exe', 'chrome-headless-shell.exe')
$now = Get-Date
$all = Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name }

$found = 0
foreach ($p in $all) {
  $cl = "$($p.CommandLine)"
  if ($cl -match '--type=') { continue }
  if ($cl -notmatch '--headless') { continue }
  if ($cl -notmatch '--user-data-dir="?([^"]+?)"?(\s--|\s*$)') { continue }
  $prof = $matches[1].Trim()
  try { $full = [IO.Path]::GetFullPath($prof).TrimEnd('\') } catch { continue }
  if (-not $full.StartsWith($temp + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
  $ageH = ($now - $p.CreationDate).TotalHours
  if ($ageH -lt $MaxAgeHours) { continue }
  if (Test-Path -LiteralPath (Join-Path $full '.keep-alive')) {
    Write-Log ("skip pid={0} age={1:N1}h keep-alive profile={2}" -f $p.ProcessId, $ageH, $full)
    continue
  }
  $found++
  if ($DryRun) {
    Write-Log ("DRYRUN would stop pid={0} {1} age={2:N1}h profile={3}" -f $p.ProcessId, $p.Name, $ageH, $full)
    continue
  }
  taskkill /T /F /PID $p.ProcessId 2>&1 | Out-Null
  Start-Sleep -Milliseconds 1500
  Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue
  Write-Log ("stopped pid={0} {1} age={2:N1}h profile={3} profileDeleted={4}" -f $p.ProcessId, $p.Name, $ageH, $full, (-not (Test-Path -LiteralPath $full)))
}
if ($DryRun -and $found -eq 0) { "DRYRUN nothing to stop (MaxAgeHours=$MaxAgeHours)" }
