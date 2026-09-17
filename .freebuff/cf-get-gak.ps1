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

# Find and click on Global API Key "Change" or "View" button
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and ($name -match 'Global API Key' -or $name -match 'View' -or $name -match 'Change')) {
            $type = $el.Current.ControlType.ProgrammaticName
            $bounds = $el.Current.BoundingRectangle
            Write-Host "Found: [$type] '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
        }
    } catch {}
}

# Try to find the View/Change button near Global API Key
Write-Host "`nLooking for buttons near Global API Key..."
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Button' -and $name -and $name -match 'Change|View|Reveal') {
            $bounds = $el.Current.BoundingRectangle
            Write-Host "Button: '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
        }
        if ($type -eq 'ControlType.Hyperlink' -and $name -and $name -match 'Change|View|Reveal') {
            $bounds = $el.Current.BoundingRectangle
            Write-Host "Link: '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
        }
    } catch {}
}
