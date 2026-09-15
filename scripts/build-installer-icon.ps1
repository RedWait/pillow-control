param([string]$Source = 'src-tauri/icons/installer.png', [string]$Output = 'src-tauri/icons/installer.ico')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourceImage = [Drawing.Image]::FromFile((Resolve-Path -LiteralPath $Source))
$sizes = @(16,24,32,48,64,128,256)
$frames = @()
foreach ($size in $sizes) {
  $bitmap = New-Object Drawing.Bitmap($size,$size)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($sourceImage,0,0,$size,$size)
  $stream = New-Object IO.MemoryStream
  $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
  $frames += ,$stream.ToArray()
  $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$sourceImage.Dispose()
$file = [IO.File]::Create([IO.Path]::GetFullPath($Output))
$writer = New-Object IO.BinaryWriter($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i=0; $i -lt $sizes.Count; $i++) {
  $dimension = if ($sizes[$i] -eq 256) {0} else {$sizes[$i]}
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
  $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
  $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($frame in $frames) {$writer.Write([byte[]]$frame)}
$writer.Dispose(); $file.Dispose()
Write-Output "Created $Output with 7 icon sizes."
