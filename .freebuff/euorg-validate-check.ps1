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

# Read URL first
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "URL: $($vp.Current.Value)" }
            break
        }
    } catch {}
}

# Read page content via JS
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = 'javascript:void(document.title="PAGE:"+document.body.innerText.substring(0,2000))'
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host "PAGE CONTENT:"
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}

# Also read all links and buttons on page
Write-Host "`nLINKS AND BUTTONS:"
$allElements3 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements3) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($name -and $name.Length -gt 2 -and $name.Length -lt 100) {
            if ($type -eq 'ControlType.Hyperlink' -or ($type -eq 'ControlType.Button' -and $name -notmatch 'Minimize|Restore|Close|Back|Forward|Reload|View site|Bookmark|MetaMask|Pelagus|Extension|Chrome|Tab group|Control your|Creator|Tab search|New Tab|Open Gemini')) {
                $bounds = $el.Current.BoundingRectangle
                Write-Host "[$type] '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
            }
        }
    } catch {}
}
