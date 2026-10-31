param([switch]$SelfTest)

function Protect-CommandLine([string]$CommandLine) {
    $text = $CommandLine -replace '[\r\n]+', ' '
    $text = $text -replace '(?i)\bBearer\s+[^\s"'';]+', 'Bearer [REDACTED]'
    $text = $text -replace '(?i)\b(sk-|ghp_|xai-)[a-z0-9_-]+', '$1[REDACTED]'
    return $text
}

if ($SelfTest) {
    $sample = 'sk-secret Bearer token123 ghp_secret xai-secret'
    if ((Protect-CommandLine $sample) -ne 'sk-[REDACTED] Bearer [REDACTED] ghp_[REDACTED] xai-[REDACTED]') { throw 'Redaction failed' }
    Write-Output 'Redaction test passed'
    return
}

$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root '.ai-agents/console_trace.log'
$seen = @{}
foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
    $seen["$($process.ProcessId):$($process.CreationDate)"] = $true
}
$interesting = @('conhost.exe', 'cmd.exe', 'powershell.exe', 'node.exe', 'git.exe')
Write-Host "Recording to $log. Press Ctrl+C to stop."
while ($true) {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $current = @{}
    foreach ($process in $processes) { $current[[int]$process.ProcessId] = $process }
    $nextSeen = @{}
    foreach ($process in $processes) {
        $pidKey = [int]$process.ProcessId
        $identity = "${pidKey}:$($process.CreationDate)"
        $nextSeen[$identity] = $true
        if ($seen.ContainsKey($identity)) { continue }
        $parent = $current[[int]$process.ParentProcessId]
        $parentName = if ($parent) { $parent.Name } else { 'unknown' }
        $marker = if ($process.Name -in $interesting) { '*' } else { ' ' }
        $candidate = if ($parentName -ieq 'ai-cli-manager.exe' -and $process.Name -in $interesting) { ' [direct-app-child: investigate]' } else { '' }
        $command = Protect-CommandLine ([string]$process.CommandLine)
        $line = '{0:HH:mm:ss.fff} {1}{2} PID={3} PPID={4} parent={5}{6} command={7}' -f (Get-Date), $marker, $process.Name, $pidKey, $process.ParentProcessId, $parentName, $candidate, $command
        Add-Content -LiteralPath $log -Value $line -Encoding UTF8
    }
    $seen = $nextSeen
    Start-Sleep -Milliseconds 250
}
