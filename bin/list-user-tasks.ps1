<#
.SYNOPSIS
  List scheduled tasks that are not Windows system tasks (TaskPath not under \Microsoft\).
.DESCRIPTION
  Use this to find periodic automations (yours or installed by apps) before you stop or disable them.
  Uses -notlike, not a regex: '^\Microsoft\' fails with "Unrecognized escape sequence \M".
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "<pi-setup>\bin\list-user-tasks.ps1"
  ... -Match 'Backup|Sync'          # filter on name, path, or action (regex)
  ... -EnabledOnly                   # hide Disabled tasks
#>
param(
  [string]$Match = '',
  [switch]$EnabledOnly
)

Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object {
  $task = $_
  $info = Get-ScheduledTaskInfo -TaskName $task.TaskName -TaskPath $task.TaskPath -ErrorAction SilentlyContinue
  $trig = ($task.Triggers | ForEach-Object {
    $kind = $_.CimClass.CimClassName -replace 'MSFT_Task', '' -replace 'Trigger', ''
    if ($_.Repetition -and $_.Repetition.Interval) { "$kind/$($_.Repetition.Interval)" } else { $kind }
  }) -join ','
  $act = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join ' | '
  [pscustomobject]@{
    Path   = $task.TaskPath
    Name   = $task.TaskName
    State  = $task.State
    Author = $task.Author
    Trig   = $trig
    Next   = $info.NextRunTime
    Last   = $info.LastRunTime
    Action = $act.Substring(0, [Math]::Min(160, $act.Length))
  }
} | Where-Object {
  (-not $EnabledOnly -or $_.State -ne 'Disabled') -and
  (-not $Match -or "$($_.Path)$($_.Name) $($_.Action)" -match $Match)
} | Sort-Object State, Name | Format-List | Out-String -Width 300
