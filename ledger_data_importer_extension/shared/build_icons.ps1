# Rebuild the outlined Ledger mark and its Chrome PNG exports on Windows.
# Uses the app's Georgia Bold L, #3f7659 green, and 10/10/10/3 corner radii.
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot 'icons'
[IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
$font = [System.Drawing.FontFamily]::new('Georgia')
$letter = [System.Drawing.Drawing2D.GraphicsPath]::new()
$letter.AddString('L', $font, [int][System.Drawing.FontStyle]::Bold, 19, [System.Drawing.PointF]::new(0,0), [System.Drawing.StringFormat]::GenericTypographic)
$bounds = $letter.GetBounds()
$center = [System.Drawing.Drawing2D.Matrix]::new()
$center.Translate((34 - $bounds.Width) / 2 - $bounds.X, (34 - $bounds.Height) / 2 - $bounds.Y)
$letter.Transform($center)
$center.Dispose()
$background = [System.Drawing.Drawing2D.GraphicsPath]::new()
$background.AddArc(0,0,20,20,180,90)
$background.AddArc(14,0,20,20,270,90)
$background.AddArc(14,14,20,20,0,90)
$background.AddArc(0,28,6,6,90,90)
$background.CloseFigure()

function ConvertTo-SvgPath($shape) {
    $points = $shape.PathPoints
    $types = $shape.PathTypes
    $parts = [Collections.Generic.List[string]]::new()
    function Coordinate($point) {
        return $point.X.ToString('0.####',[Globalization.CultureInfo]::InvariantCulture) + ' ' + $point.Y.ToString('0.####',[Globalization.CultureInfo]::InvariantCulture)
    }
    for ($index = 0; $index -lt $points.Length; $index++) {
        $kind = $types[$index] -band 7
        if ($kind -eq 0) { $parts.Add('M ' + (Coordinate $points[$index])) }
        elseif ($kind -eq 1) { $parts.Add('L ' + (Coordinate $points[$index])) }
        elseif ($kind -eq 3) {
            $parts.Add('C ' + (Coordinate $points[$index]) + ' ' + (Coordinate $points[$index + 1]) + ' ' + (Coordinate $points[$index + 2]))
            $index += 2
        }
        if ($types[$index] -band 128) { $parts.Add('Z') }
    }
    return $parts -join ' '
}
$svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" role="img" aria-label="Ledger">' + "`n" +
    '  <title>Ledger</title>' + "`n" +
    '  <path fill="#3f7659" d="' + (ConvertTo-SvgPath $background) + '"/>' + "`n" +
    '  <path fill="#fff" d="' + (ConvertTo-SvgPath $letter) + '"/>' + "`n" + '</svg>' + "`n"
[IO.File]::WriteAllText((Join-Path $iconDirectory 'ledger.svg'), $svg)

$large = [System.Drawing.Bitmap]::new(1024,1024)
$graphics = [System.Drawing.Graphics]::FromImage($large)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.ScaleTransform(1024 / 34,1024 / 34)
$green = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#3f7659'))
$graphics.FillPath($green,$background)
$graphics.FillPath([System.Drawing.Brushes]::White,$letter)
$graphics.Dispose()
foreach ($size in @(16,32,48,96,128)) {
    $bitmap = [System.Drawing.Bitmap]::new($size,$size)
    $canvas = [System.Drawing.Graphics]::FromImage($bitmap)
    $canvas.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $canvas.DrawImage($large,[System.Drawing.Rectangle]::new(0,0,$size,$size),0,0,1024,1024,[System.Drawing.GraphicsUnit]::Pixel)
    $bitmap.Save((Join-Path $iconDirectory "icon-$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()
    $bitmap.Dispose()
}
$large.Dispose()
$font.Dispose()
$letter.Dispose()
$background.Dispose()
$green.Dispose()
