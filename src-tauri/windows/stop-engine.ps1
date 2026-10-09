# Asks the engine running from the install folder to stop (`service stop`) without cutting work.
# Exit codes: 0 no engine from that folder is left, 2 it has turns or downloads in flight,
# 3 it did not answer. NSIS runs this from its 32-bit PowerShell: paths come from WMI.
param([Parameter(Mandatory = $true)] [string] $InstallDir)
$ErrorActionPreference = 'Stop'
$endpointFile = Join-Path $env:LOCALAPPDATA 'ai.danil.seldon.dev\engine\seldon-endpoint.json'

function Get-Engines {
  @(Get-CimInstance Win32_Process -Filter "Name='seldon-runtime.exe'" |
    Where-Object { $_.ExecutablePath -like (Join-Path $InstallDir '*') })
}

function Send-Stop($endpoint, $token) {
  $address, $port = $endpoint.address -split ':(?=\d+$)'
  $client = New-Object Net.Sockets.TcpClient
  try {
    $client.Connect($address, [int]$port)
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $request = @{
      version = 1; token = $token; workspace = $null; folder = $null
      command = 'service stop'; args = @{}; request_id = [guid]::NewGuid().ToString()
    } | ConvertTo-Json -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($request + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
    (New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)).ReadLine() | ConvertFrom-Json
  } finally {
    $client.Close()
  }
}

if (-not (Get-Engines)) { exit 0 }
try {
  $endpoint = Get-Content $endpointFile -Raw | ConvertFrom-Json
  $token = (Get-Content $endpoint.token_file -Raw).Trim()
} catch { exit 3 }
if (-not (Get-Engines | Where-Object { $_.ProcessId -eq $endpoint.pid })) { exit 3 }

# Open requests count as work for a few moments; turns and downloads do not end on their own.
$deadline = (Get-Date).AddSeconds(10)
while ($true) {
  try { $reply = Send-Stop $endpoint $token } catch { exit 3 }
  if ($reply.result.stopping -eq $true) { break }
  if ($reply.error.code -ne 'task_busy') { exit 3 }
  $onlyRequests = $null -eq $reply.error.detail.turns -and $reply.error.detail.downloading -ne $true
  if (-not $onlyRequests -or (Get-Date) -ge $deadline) { exit 2 }
  Start-Sleep -Milliseconds 250
}
$process = Get-Process -Id $endpoint.pid -ErrorAction SilentlyContinue
if ($process -and -not $process.WaitForExit(15000)) { exit 3 }
exit 0
