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
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $vp.SetValue("https://www.dynu.com/en-US/Members/DNS/Free")
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating to Dynu..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 6

# Read page
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
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                Write-Host "URL: $($vp.Current.Value)"
            }
            break
        }
    } catch {}
}

$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = @()
foreach ($el in $allElements2) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 1) {
            $found += "Edit: $name"
        }
        if ($type -eq 'ControlType.Hyperlink' -and $name -and $name.Length -gt 2 -and $name.Length -lt 100) {
            $found += "Link: $name"
        }
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 2 -and $name.Length -lt 60) {
            if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group') {
                $found += "Button: $name"
            }
        }
        if ($type -eq 'ControlType.CheckBox' -and $name) {
            $found += "Check: $name"
        }
    } catch {}
}
Write-Host "Title: $($chrome.Current.Name)"
$found | Select-Object -First 30
