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

# Click on "Domains" link
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -eq 'Domains' -and $el.Current.ControlType.ProgrammaticName -eq 'ControlType.Hyperlink') {
            $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked Domains link"
            } else {
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter on Domains link"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Read the page
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and $name.Length -gt 1 -and $name.Length -lt 300) {
            if ($name -match 'omnistore|eu\.org|Free|Pending|NS |nameserver|CNAME|Active') {
                $found += "[$($el.Current.ControlType.ProgrammaticName)] $name"
            }
        }
    } catch {}
}
Write-Host "URL elements found: $($found.Count)"
$found
