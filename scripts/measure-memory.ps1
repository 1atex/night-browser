param(
    [Parameter(Mandatory = $true)]
    [int]$RootProcessId,
    [ValidateRange(1, 3600)]
    [int]$Samples = 120,
    [ValidateRange(1, 300)]
    [int]$IntervalSeconds = 5,
    [string]$OutputPath = "night-memory.csv"
)

$ErrorActionPreference = "Stop"
if (Test-Path -LiteralPath $OutputPath) {
    throw "Output already exists: $OutputPath"
}
$root = Get-CimInstance Win32_Process -Filter "ProcessId = $RootProcessId"
if (-not $root) {
    throw "Browser process $RootProcessId was not found."
}
$started = $root.CreationDate

for ($sample = 0; $sample -lt $Samples; $sample++) {
    $processes = @(Get-CimInstance Win32_Process)
    $currentRoot = $processes | Where-Object {
        $_.ProcessId -eq $RootProcessId -and $_.CreationDate -eq $started
    }
    if (-not $currentRoot) {
        throw "The browser exited. Collected samples remain in $OutputPath."
    }

    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootProcessId)
    do {
        $previousCount = $ids.Count
        foreach ($process in $processes) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $process.CreationDate -ge $started) {
                [void]$ids.Add([int]$process.ProcessId)
            }
        }
    } while ($ids.Count -gt $previousCount)

    $counters = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {
        $ids.Contains([int]$_.IDProcess)
    })
    if (-not $counters.Count) {
        throw "No process memory counters were available."
    }
    [pscustomobject]@{
        TimestampUtc = [DateTime]::UtcNow.ToString("o")
        RootProcessId = $RootProcessId
        Processes = $counters.Count
        PrivateWorkingSetMiB = [Math]::Round(($counters | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB, 2)
        WorkingSetMiB = [Math]::Round(($counters | Measure-Object WorkingSet -Sum).Sum / 1MB, 2)
        PrivateBytesMiB = [Math]::Round(($counters | Measure-Object PrivateBytes -Sum).Sum / 1MB, 2)
    } | Export-Csv -LiteralPath $OutputPath -Append -NoTypeInformation -Encoding UTF8

    if ($sample + 1 -lt $Samples) {
        Start-Sleep -Seconds $IntervalSeconds
    }
}
