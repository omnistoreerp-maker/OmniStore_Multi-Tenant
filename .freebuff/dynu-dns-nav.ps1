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
                $url = "https://www.dynu.com/en-US/ControlPanel/DDNSRecord?ATVPDKIKX0DER=RABvAG0AYQBpAG4ATgBhAG0AZQA9AGMAYQBpAHIAbwB0AGUAYwBoAC4AbwBvAGcAdQB5AC4AYwBvAG0A"
                $vp.SetValue($url)
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating to DNS Records..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 8

# Read page
$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

foreach ($el in $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "URL: $($vp.Current.Value)" }
            break
        }
    } catch {}
}

Write-Host "Title: $($chrome.Current.Name)"

foreach ($el in $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = 'javascript:void(document.title="PAGE:"+document.body.innerText.substring(0,3000))'
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

$chromeWindows3 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows3) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
