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

# Click "Create Account"
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -eq 'Create Account') {
            $invokePattern = $null
            try { $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked Create Account via InvokePattern"
            } else {
                # Try link pattern
                $linkPattern = $null
                try { $linkPattern = $el.GetCurrentPattern([System.Windows.Automation.AutomationElement]::Pattern) } catch {}
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter on Create Account"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 6

# Read the registration page
$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "URL: $($vp.Current.Value)" }
            break
        }
    } catch {}
}

Write-Host "Title: $($chrome.Current.Name)"

$found = @()
foreach ($el in $allElements2) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 1) {
            $found += "Edit: $name"
        }
        if ($type -eq 'ControlType.CheckBox' -and $name) {
            $found += "Check: $name"
        }
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 2 -and $name.Length -lt 60) {
            if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group') {
                $found += "Button: $name"
            }
        }
        if ($type -eq 'ControlType.Hyperlink' -and $name -and $name.Length -gt 2 -and $name.Length -lt 60) {
            if ($name -match 'sign|register|login|create|account|captcha|verify') {
                $found += "Link: $name"
            }
        }
    } catch {}
}
Write-Host "Form elements:"
$found | Select-Object -First 20
