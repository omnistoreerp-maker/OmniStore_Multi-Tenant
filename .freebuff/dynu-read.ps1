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
        if ($name -and $name.Length -gt 2 -and $name.Length -lt 200) {
            if ($type -eq 'ControlType.Edit' -or $type -eq 'ControlType.Button' -or $type -eq 'ControlType.Hyperlink' -or $type -eq 'ControlType.CheckBox') {
                if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group|address') {
                    $found += "[$type] $name"
                }
            }
        }
    } catch {}
}
Write-Host "Form elements:"
$found | Select-Object -First 30
