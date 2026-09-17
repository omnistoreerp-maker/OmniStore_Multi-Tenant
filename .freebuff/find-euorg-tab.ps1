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

# Find all tabs
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$tabs = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.TabItem' -and $name -and $name.Length -gt 5) {
            $tabs += "Tab: $name"
            if ($name -match 'eu\.org|EU\.ORG|nic\.eu|Contact|Validate|OS774') {
                Write-Host "FOUND EU.ORG TAB: $name"
                try {
                    $el.SetFocus()
                    Start-Sleep -Milliseconds 300
                    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                    Write-Host "Switched to EU.org tab"
                } catch {
                    Write-Host "Could not switch"
                }
            }
        }
    } catch {}
}

Write-Host "`nAll tabs:"
$tabs | Select-Object -First 20
