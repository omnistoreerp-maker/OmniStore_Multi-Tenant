Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}
if (-not $chrome) { Write-Host "No Chrome"; exit 1 }

# Take screenshot
$bounds = $chrome.Current.BoundingRectangle
$screenshot = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($screenshot)
$graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $screenshot.Size)
$screenshot.Save("E:\Projects\OmniStore_Multi-Tenant\.freebuff\cloudns-signup.png")
$graphics.Dispose()
$screenshot.Dispose()
Write-Host "Screenshot saved"
