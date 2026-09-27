param(
    [string]$Time = "08:30",
    [string]$TaskName = "Divgrow Content Studio Daily"
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = (Get-Command python -ErrorAction Stop).Source
$script = Join-Path $root "scripts\content_pipeline\pipeline.py"
$action = New-ScheduledTaskAction -Execute $python -Argument ('"{0}"' -f $script) -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Official-only Divgrow content studio pipeline" -Force
Write-Output "Installed scheduled task: $TaskName at $Time"
