$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path $compiler)) { throw 'Requires Windows x64 and .NET Framework 4.8.' }
New-Item -ItemType Directory -Force (Join-Path $projectRoot 'native/bin') | Out-Null
$nativeOutput = Join-Path $projectRoot 'native\bin\PillowControl.Helper.exe'
$nativeSource = Join-Path $projectRoot 'native\Helper.cs'
& $compiler /nologo /codepage:65001 /target:exe /platform:x64 /optimize+ /reference:System.Web.Extensions.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$nativeOutput" $nativeSource
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed' }

