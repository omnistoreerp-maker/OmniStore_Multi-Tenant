Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

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

# First navigate back to Dynu signup
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                Write-Host "Current URL: $($vp.Current.Value)"
            }
            break
        }
    } catch {}
}

# List ALL buttons and their positions
$found = @()
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 1 -and $name.Length -lt 50) {
            if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group|Control your|Creator|Tab search|New Tab|Open Gemini') {
                $bounds = $el.Current.BoundingRectangle
                $found += "[$type] '$name' at ($([int]$bounds.X),$([int]$bounds.Y)) size ($([int]$bounds.Width)x$([int]$bounds.Height))"
            }
        }
    } catch {}
}
Write-Host "All buttons:"
$found
