Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Take a screenshot of the full screen
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

# Save to file
$path = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-screenshot.png"
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Output "Screenshot saved to: $path"
