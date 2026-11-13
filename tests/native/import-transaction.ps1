param([Parameter(Mandatory=$true)][string]$Launcher)
$ErrorActionPreference = "Stop"
$root = Join-Path $env:RUNNER_TEMP ("Night transaction " + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $root | Out-Null
Copy-Item $Launcher (Join-Path $root "Night.exe")
function Apply-Import {
  $process = Start-Process (Join-Path $root "Night.exe") -ArgumentList "--apply-import" -PassThru -Wait
  return $process.ExitCode
}
function Plan-Import {
  $id = [Guid]::NewGuid().ToString("N")
  $stage = "import-stage-$id"
  $backup = "profile-backup-$id"
  New-Item -ItemType Directory (Join-Path $root $stage) | Out-Null
  @{stage=$stage;backup=$backup} | ConvertTo-Json | Set-Content (Join-Path $root "night-import.json") -Encoding utf8
  return @{stage=$stage;backup=$backup}
}
try {
  $profile = Join-Path $root "profile"
  New-Item -ItemType Directory $profile | Out-Null
  "original" | Set-Content (Join-Path $profile "sentinel.txt")
  $plan = Plan-Import
  if ((Apply-Import) -eq 0) { throw "Incomplete stage was accepted" }
  if ((Get-Content (Join-Path $profile "sentinel.txt")) -ne "original") { throw "Incomplete import changed the profile" }
  $plan.stage | Set-Content (Join-Path $root "$($plan.stage)/night-import-ready.json") -Encoding utf8
  "imported" | Set-Content (Join-Path $root "$($plan.stage)/sentinel.txt")
  $lock = [IO.File]::Open((Join-Path $profile "parent.lock"),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
  try { Apply-Import | Out-Null } finally { $lock.Dispose() }
  if ((Get-Content (Join-Path $profile "sentinel.txt")) -ne "original") { throw "Locked Night profile changed" }
  if ((Apply-Import) -ne 0) { throw "Ready import failed" }
  if ((Get-Content (Join-Path $profile "sentinel.txt")) -ne "imported") { throw "Imported profile not activated" }
  if ((Get-Content (Join-Path $root "$($plan.backup)/sentinel.txt")) -ne "original") { throw "Original Night backup lost" }
  $next = Plan-Import
  $next.stage | Set-Content (Join-Path $root "$($next.stage)/night-import-ready.json") -Encoding utf8
  "recovered" | Set-Content (Join-Path $root "$($next.stage)/sentinel.txt")
  Move-Item $profile (Join-Path $root $next.backup)
  if ((Apply-Import) -ne 0 -or (Get-Content (Join-Path $profile "sentinel.txt")) -ne "recovered") { throw "Interrupted directory swap did not recover" }
  @{stage=$next.stage;backup=$next.backup} | ConvertTo-Json | Set-Content (Join-Path $root "night-import.json") -Encoding utf8
  if ((Apply-Import) -ne 0 -or (Test-Path (Join-Path $root "night-import.json"))) { throw "Completed swap journal did not recover" }
  Write-Output "PASS: incomplete import rejected, live profile protected, backup retained, interrupted and completed swaps recover"
} finally { Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue }
