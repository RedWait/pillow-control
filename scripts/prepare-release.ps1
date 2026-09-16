param([string]$KeyPath = (Join-Path $env:USERPROFILE '.pillow-control-signing/updater.key'))
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) { throw 'Signing key not found. No files were changed.' }
$version = (Get-Content -Raw -Encoding UTF8 -LiteralPath 'package.json' | ConvertFrom-Json).version
$notes = "docs/RELEASE-$version.md"
if (-not (Test-Path -LiteralPath $notes -PathType Leaf)) { throw 'Release notes are missing.' }
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
try {
    Write-Host "Prepare PillowControl $version signed packages. This does not publish."
    $secret = Read-Host 'Enter the updater key password (hidden input)' -AsSecureString
    $credential = New-Object System.Net.NetworkCredential('', $secret)
    $env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $credential.Password
    & node scripts/update-release.mjs prepare $notes
    if ($LASTEXITCODE -ne 0) { throw 'Signed packaging failed. Nothing was published; inspect the error above.' }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
    if ($secret) { $secret.Dispose() }
    $credential = $null
}
