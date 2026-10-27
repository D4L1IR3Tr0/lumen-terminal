# Draws the app icon: assets/icon.png (256 px, window icon), assets/icon.ico (Windows, PNG-in-ICO)
# and assets/icon-1024.png (macOS and Linux builds need at least 512 px).
# Run from a PowerShell prompt: .\scripts\make-icon.ps1
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\assets'
New-Item -ItemType Directory -Force $out | Out-Null

function RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# The drawing is designed on a 256 grid and scaled to any size.
function Render([int]$size, [string]$file) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform($size / 256, $size / 256)

  $blue = [System.Drawing.Color]::FromArgb(255, 122, 162, 247)
  $violet = [System.Drawing.Color]::FromArgb(255, 187, 154, 247)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 256, 256), $blue, $violet

  $bg = RoundedRect 8 8 240 240 56
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 22, 22, 30))), $bg)
  $edge = New-Object System.Drawing.Pen $grad, 3
  $edge.Color = [System.Drawing.Color]::FromArgb(140, 150, 160, 247)
  $g.DrawPath($edge, $bg)

  $pen = New-Object System.Drawing.Pen $grad, 22
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $chevron = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 66, 78), (New-Object System.Drawing.Point 120, 128), (New-Object System.Drawing.Point 66, 178))
  $g.DrawLines($pen, $chevron)
  $g.DrawLine($pen, 136, 178, 192, 178)
  $g.Dispose()

  $path = Join-Path $out $file
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return $path
}

$pngPath = Render 256 'icon.png'
Render 1024 'icon-1024.png' | Out-Null

# ICO header + single directory entry pointing at the PNG bytes.
$png = [System.IO.File]::ReadAllBytes($pngPath)
$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ms
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)
$w.Write([UInt16]1); $w.Write([UInt16]32)
$w.Write([UInt32]$png.Length); $w.Write([UInt32]22)
$w.Write($png)
[System.IO.File]::WriteAllBytes((Join-Path $out 'icon.ico'), $ms.ToArray())
Write-Output "ok"
