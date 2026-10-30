param([Parameter(Mandatory)][ValidateSet('prepare','internal','package','final')][string]$Phase)
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
if ($Phase -eq 'internal') {
  $main = Join-Path $candidate $manifest.main
  if (-not [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($main)).Contains('__TAURI_BUNDLE_TYPE_VAR_NSS')) { throw 'Main executable lacks NSIS bundle marker' }
  foreach ($role in @('main','engine')) {
    $file = Join-Path $candidate $manifest.$role
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -eq 'NotSigned') { Sign-File $file }
    $null = Assert-Signature $file
  }
} elseif ($Phase -eq 'package') {
  $makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe'
  if (-not (Test-Path $makensis)) { throw 'Reviewed NSIS toolchain unavailable; no build fallback' }
  if ((Get-FileHash $makensis -Algorithm SHA256).Hash -ne $manifest.makensis_sha256) { throw 'NSIS toolchain mismatch; no installation fallback' }
  Push-Location $candidate
  try { & $makensis '/V2' $manifest.nsis_script; Assert-Native } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $candidate $manifest.installer))) { throw 'NSIS did not produce declared installer' }
} else {
  New-Item -ItemType Directory -Force output | Out-Null
  Copy-Item -LiteralPath (Join-Path $candidate $manifest.installer) -Destination output/Terminus-Windows-Setup.exe
  Sign-File (Join-Path $base 'output/Terminus-Windows-Setup.exe')
  Get-FileHash output/Terminus-Windows-Setup.exe -Algorithm SHA256 | Format-List | Out-File output/windows-signing-hash.txt
}
