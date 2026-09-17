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

# Read all buttons on the page
Write-Host "ALL BUTTONS:"
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 1 -and $name.Length -lt 60) {
            if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group|Control your|Creator|Tab search|New Tab|Open Gemini') {
                $bounds = $el.Current.BoundingRectangle
                Write-Host "Button: '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
            }
        }
    } catch {}
}

# Also read all edit fields
Write-Host "`nALL EDIT FIELDS:"
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 0) {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $val = if ($vp) { $vp.Current.Value } else { "N/A" }
            Write-Host "Edit: name='$name' value='$val'"
        }
    } catch {}
}

# Read all combo boxes
Write-Host "`nALL COMBO BOXES:"
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $val = if ($vp) { $vp.Current.Value } else { "N/A" }
            $bounds = $el.Current.BoundingRectangle
            Write-Host "ComboBox: value='$val' at ($([int]$bounds.X),$([int]$bounds.Y))"
        }
    } catch {}
}
