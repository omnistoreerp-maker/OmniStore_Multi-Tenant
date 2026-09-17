# Navigate Chrome to Cloudflare dashboard for omnistore.eu.org DNS/NS page
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

# Find the address bar
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $valuePattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($valuePattern) {
                $url = "https://dash.cloudflare.com/"
                $valuePattern.SetValue($url)
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigated to: $url"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 4

# Now read page to find omnistore.eu.org
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

if ($chrome) {
    $allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $found = @()
    foreach ($el in $allElements) {
        try {
            $name = $el.Current.Name
            if ($name -and $name.Length -gt 3 -and $name.Length -lt 200 -and $name -notmatch 'Chrome|menu|button|tab|navigation') {
                $found += $name
            }
        } catch {}
    }
    $found | Select-Object -Unique | Select-Object -First 60
}
