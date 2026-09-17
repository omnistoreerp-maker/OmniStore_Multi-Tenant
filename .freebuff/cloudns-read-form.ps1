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

# Read all edit fields and checkboxes
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 0) {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $val = if ($vp) { $vp.Current.Value } else { "N/A" }
            $found += "Edit: name='$name' value='$val'"
        }
        if ($type -eq 'ControlType.CheckBox' -and $name) {
            $found += "Check: $name"
        }
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 2 -and $name.Length -lt 60) {
            if ($name -match 'Sign|Create|Register|Submit|Save|agree') {
                $found += "Button: $name"
            }
        }
        if ($type -eq 'ControlType.Hyperlink' -and $name -and $name.Length -gt 2 -and $name.Length -lt 60) {
            if ($name -match 'Sign up|Create|register') {
                $found += "Link: $name"
            }
        }
    } catch {}
}
Write-Host "Form elements:"
$found
