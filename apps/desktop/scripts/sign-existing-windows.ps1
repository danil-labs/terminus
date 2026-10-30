param([Parameter(Mandatory)][ValidateSet('prepare','inspect','internals','installer')][string]$Phase)
$ErrorActionPreference = 'Stop'
$base = (Get-Location).Path
$tools = Join-Path $base 'signing-tools'
$candidate = Join-Path $base 'candidate'

function Assert-Native { if ($LASTEXITCODE -ne 0) { throw 'External command failed' } }
function Assert-Signature([string]$File) {
  $signature = Get-AuthenticodeSignature -LiteralPath $File
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Software y Servicios Danil*' -or -not $signature.TimeStamperCertificate) {
    throw "Invalid Danil timestamped signature: $File"
  }
  return $signature
}
function Assert-PE([string]$File, [int]$Machine = 34404) {
  $bytes = [IO.File]::ReadAllBytes($File)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 77 -or $bytes[1] -ne 90) { throw 'Not a PE executable' }
  $offset = [BitConverter]::ToUInt32($bytes, 60)
  if ($offset -gt $bytes.Length - 26 -or [BitConverter]::ToUInt32($bytes, $offset) -ne 17744 -or [BitConverter]::ToUInt16($bytes, $offset + 4) -ne $Machine) { throw 'Unexpected PE machine' }
}
function Assert-Main([string]$File) {
  Assert-PE $File
  $config = Get-Content "$base/apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
  $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($File)
  if ($version.ProductName -ne $config.productName -or $version.ProductVersion -ne $config.version) { throw 'Native product/version mismatch' }
  $text = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($File))
  if (-not $text.Contains('__TAURI_BUNDLE_TYPE_VAR_NSS')) { throw 'Native NSIS marker missing' }
  return @{product_name=$version.ProductName; product_version=$version.ProductVersion; architecture='x86_64'; identifier_source='externally pinned build receipt; PE has no native bundle ID'}
}
function Sign-File([string]$File) {
  foreach ($key in @('ES_USERNAME','ES_PASSWORD','ES_CREDENTIAL_ID','ES_TOTP_SECRET')) {
    if (-not [Environment]::GetEnvironmentVariable($key)) { throw "Missing $key" }
  }
  $inDir = Join-Path $tools 'input'
  $outDir = Join-Path $tools 'output'
  Remove-Item $inDir,$outDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory $inDir,$outDir | Out-Null
  $name = Split-Path -Leaf $File
  Copy-Item -LiteralPath $File -Destination (Join-Path $inDir $name)
  # No comparte un TOTP con otra operación; nunca firma work-tools.
  Start-Sleep -Seconds 31
  Push-Location (Join-Path $tools 'cst')
  try {
    & './jdk-11.0.2/bin/java.exe' -jar 'jar/code_sign_tool-1.3.2.jar' sign "-username=$env:ES_USERNAME" "-password=$env:ES_PASSWORD" "-credential_id=$env:ES_CREDENTIAL_ID" "-totp_secret=$env:ES_TOTP_SECRET" "-input_file_path=$(Join-Path $inDir $name)" "-output_dir_path=$outDir"
    Assert-Native
  } finally { Pop-Location }
  $signed = Join-Path $outDir $name
  $null = Assert-Signature $signed
  Copy-Item -LiteralPath $signed -Destination $File -Force
}

if ($Phase -eq 'prepare') {
  New-Item -ItemType Directory -Force $tools | Out-Null
  Invoke-WebRequest 'https://github.com/SSLcom/CodeSignTool/releases/download/v1.3.2/CodeSignTool-v1.3.2-windows.zip' -OutFile "$tools/cst.zip"
  Invoke-WebRequest 'http://cert.ssl.com/SSLcom-TLS-Root-2022-RSA.cer' -OutFile "$tools/root.cer"
  if ((Get-FileHash "$tools/cst.zip" -Algorithm SHA256).Hash -ne '4afc32e8b7f79bbe1de7e4e7049aaad4e0f754357613b9bbec0e3052f06fd36b') { throw 'CodeSignTool hash mismatch' }
  if ((Get-FileHash "$tools/root.cer" -Algorithm SHA256).Hash -ne '8faf7d2e2cb4709bb8e0b33666bf75a5dd45b5de480f8ea8d4bfe6bebc17f2ed') { throw 'Root hash mismatch' }
  Expand-Archive "$tools/cst.zip" "$tools/cst"
  & "$tools/cst/jdk-11.0.2/bin/keytool.exe" -importcert -noprompt -trustcacerts -alias sslcomtlsroot2022 -file "$tools/root.cer" -keystore "$tools/cst/jdk-11.0.2/lib/security/cacerts" -storepass changeit
  Assert-Native
  exit 0
}
$manifest = Get-Content "$candidate/manifest.json" -Raw | ConvertFrom-Json
if ($Phase -eq 'inspect') {
  if ($manifest.windows_mode -eq 'internals') {
    $native = Assert-Main (Join-Path $candidate $manifest.main)
    Assert-PE (Join-Path $candidate $manifest.engine)
  } else {
    $installer = Join-Path $candidate $manifest.installer
    # NSIS es un launcher I386; los payloads de la aplicación son AMD64.
    Assert-PE $installer 332
    $config = Get-Content "$base/apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer)
    if ($version.ProductName -ne $config.productName -or $version.ProductVersion -ne $config.version) { throw 'Native installer product/version mismatch' }
    $seven = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
    if (-not (Test-Path $seven)) { throw '7-Zip unavailable; never execute the installer' }
    foreach ($role in @('main','engine')) {
      $payload = $manifest.signed_payloads.$role
      if ($payload.member -match '[*?\[\]]' -or $payload.member.StartsWith('-')) { throw 'Unsafe payload member' }
      $out = Join-Path $env:RUNNER_TEMP "payload-$role.exe"
      $start = [Diagnostics.ProcessStartInfo]::new($seven)
      $start.UseShellExecute = $false
      $start.RedirectStandardOutput = $true
      foreach ($arg in @('e','-so','--',$installer,$payload.member)) { $start.ArgumentList.Add($arg) }
      $process = [Diagnostics.Process]::Start($start)
      $stream = [IO.File]::Create($out)
      try { $process.StandardOutput.BaseStream.CopyTo($stream) } finally { $stream.Dispose() }
      $process.WaitForExit()
      if ($process.ExitCode -ne 0 -or (Get-FileHash $out -Algorithm SHA256).Hash -ne $payload.sha256) { throw 'Repacked payload hash mismatch' }
      $null = Assert-Signature $out
      if ($role -eq 'main') { $native = Assert-Main $out } else { Assert-PE $out }
    }
  }
  $native | ConvertTo-Json | Set-Content "$env:RUNNER_TEMP/native-identity.json"
} elseif ($Phase -eq 'internals') {
  if ($manifest.windows_mode -ne 'internals') { throw 'Phase mismatch' }
  New-Item -ItemType Directory -Force output | Out-Null
  $main = Join-Path $candidate $manifest.main
  foreach ($role in @('main','engine')) {
    $file = Join-Path $candidate $manifest.$role
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -eq 'NotSigned') { Sign-File $file }
    $null = Assert-Signature $file
    $name = if ($role -eq 'main') { 'terminus.exe' } else { 'seldon-runtime.exe' }
    Copy-Item -LiteralPath $file -Destination (Join-Path $base "output/$name")
  }
} else {
  if ($manifest.windows_mode -ne 'installer') { throw 'Phase mismatch' }
  New-Item -ItemType Directory -Force output | Out-Null
  Copy-Item -LiteralPath (Join-Path $candidate $manifest.installer) -Destination output/Terminus-Windows-Setup.exe
  Sign-File (Join-Path $base 'output/Terminus-Windows-Setup.exe')
  Get-FileHash output/Terminus-Windows-Setup.exe -Algorithm SHA256 | Format-List | Out-File output/windows-signing-hash.txt
}
