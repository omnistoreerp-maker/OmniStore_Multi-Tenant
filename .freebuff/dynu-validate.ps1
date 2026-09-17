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

# Find and click Validate button
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$clicked = $false
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($name -and ($name -match 'Validate' -or $name -match 'Submit' -or $name -match 'Confirm' -or $name -match 'Continue')) {
            Write-Host "Found: [$type] $name"
            $invokePattern = $null
            try { $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked via InvokePattern"
                $clicked = $true
                break
            }
            try { $el.SetFocus(); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait("{ENTER}"); Write-Host "Pressed Enter"; $clicked = $true; break } catch {}
        }
    } catch {}
}

if (-not $clicked) {
    Write-Host "Validate button not found. Looking for buttons..."
    foreach ($el in $allElements) {
        try {
            $name = $el.Current.Name
            $type = $el.Current.ControlType.ProgrammaticName
            if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 2 -and $name.Length -lt 40) {
                if ($name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group|address|Control your|Creator|Tab search|New Tab|Open Gemini') {
                    $bounds = $el.Current.BoundingRectangle
                    Write-Host "Button: '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
                }
            }
        } catch {}
    }
}

Start-Sleep -Seconds 5

# Read result
$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

Write-Host "Title: $($chrome.Current.Name)"
