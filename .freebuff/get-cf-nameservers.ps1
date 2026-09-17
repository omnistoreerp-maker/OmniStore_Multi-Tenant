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

if (-not $chrome) {
    Write-Host "No Chrome window found"
    exit 1
}

# Find omnistore.eu.org link
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and ($name -match 'omnistore' -or $name -match 'eu.org' -or $name -match 'NS' -or $name -match 'nameserver')) {
            $type = $el.Current.ControlType.ProgrammaticName
            Write-Host "FOUND: [$type] '$name'"
        }
    } catch {}
}
