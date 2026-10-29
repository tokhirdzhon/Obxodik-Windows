Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Background plate
$rect = New-RoundedRectPath 28 28 456 456 108
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(40, 40)),
  (New-Object System.Drawing.Point(472, 472)),
  [System.Drawing.Color]::FromArgb(255, 17, 27, 45),
  [System.Drawing.Color]::FromArgb(255, 6, 11, 19)
)
$g.FillPath($bgBrush, $rect)

$borderPen = New-Object System.Drawing.Pen(
  (New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(30, 30)),
    (New-Object System.Drawing.Point(480, 480)),
    [System.Drawing.Color]::FromArgb(110, 80, 130, 220),
    [System.Drawing.Color]::FromArgb(60, 55, 224, 192)
  )), 3
)
$g.DrawPath($borderPen, $rect)

# Soft inner glow
$glow = New-Object System.Drawing.Drawing2D.GraphicsPath
$glow.AddEllipse(70, 58, 372, 300)
$glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glow)
$glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(34, 91, 140, 255)
$glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 91, 140, 255))
$g.FillPath($glowBrush, $glow)

$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(112, 400)),
  (New-Object System.Drawing.Point(410, 104)),
  [System.Drawing.Color]::FromArgb(255, 55, 224, 192),
  [System.Drawing.Color]::FromArgb(255, 161, 107, 255)
)

# Ring with a gap in the upper-right
$pen = New-Object System.Drawing.Pen($grad, 38)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawArc($pen, 106, 106, 300, 300, 208, 272)

# Arrow breaking out of the gap
$arrowPen = New-Object System.Drawing.Pen($grad, 36)
$arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$arrowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawLine($arrowPen, 266, 266, 392, 140)
$arrowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$arrowPath.AddLine(392, 140, 312, 146)
$arrowPath.AddLine(392, 140, 386, 220)
$g.DrawPath($arrowPen, $arrowPath)

# Downscale for clean anti-aliasing
$small = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sg = [System.Drawing.Graphics]::FromImage($small)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$sg.DrawImage($bmp, 0, 0, 256, 256)

$pngPath = Join-Path $PSScriptRoot '..\resources\icon.png'
$small.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# ICO container with an embedded 256x256 PNG
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = Join-Path $PSScriptRoot '..\resources\icon.ico'
$stream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)          # reserved
$writer.Write([UInt16]1)          # type: icon
$writer.Write([UInt16]1)          # image count
$writer.Write([Byte]0)            # width 256
$writer.Write([Byte]0)            # height 256
$writer.Write([Byte]0)            # palette
$writer.Write([Byte]0)            # reserved
$writer.Write([UInt16]1)          # color planes
$writer.Write([UInt16]32)         # bits per pixel
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)         # offset
$writer.Write($pngBytes)
$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $stream.ToArray())

$writer.Dispose()
$stream.Dispose()
$g.Dispose()
$sg.Dispose()
$bmp.Dispose()
$small.Dispose()

Write-Output "icon.ico: $((Get-Item $icoPath).Length) bytes"
