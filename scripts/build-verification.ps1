$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$verificationOutput = Join-Path $projectRoot 'artifacts\VerificationHost.exe'
New-Item -ItemType Directory -Force (Join-Path $projectRoot 'artifacts') | Out-Null
& $compiler /nologo /target:exe /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$framework\WPF\UIAutomationClient.dll" "/reference:$framework\WPF\UIAutomationTypes.dll" "/reference:$framework\WPF\WindowsBase.dll" "/out:$verificationOutput" (Join-Path $projectRoot 'native\VerificationHost.cs')
if ($LASTEXITCODE -ne 0) { throw 'Verification host compilation failed' }
