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

$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($name -and $name.Length -gt 1 -and $name.Length -lt 200) {
            if ($type -eq 'ControlType.Edit' -and $name -ne 'Address and search bar' -and $name -ne 'Search') {
                $found += "Edit: $name"
            }
            if ($type -eq 'ControlType.CheckBox') {
                $found += "Check: $name"
            }
            if ($type -eq 'ControlType.Button' -and $name.Length -gt 2 -and $name.Length -lt 60) {
                if ($name -match 'sign|create|register|submit|save|complete|finish|verify|next') {
                    $found += "Button: $name"
                }
            }
            if ($type -eq 'ControlType.Hyperlink' -and $name.Length -gt 2 -and $name.Length -lt 60) {
                if ($name -match 'sign|create|register|login|captcha|verify|complete') {
                    $found += "Link: $name"
                }
            }
        }
    } catch {}
}
Write-Host "Form elements:"
$found
