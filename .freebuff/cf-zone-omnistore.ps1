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

# Navigate to Cloudflare home
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $vp.SetValue("https://dash.cloudflare.com/")
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating to Cloudflare..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 6

# Click on omnistore.eu.org zone if visible
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
$clicked = $false
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and $name -match 'omnistore.eu.org') {
            $type = $el.Current.ControlType.ProgrammaticName
            Write-Host "Found: [$type] $name"
            # Try to click it
            $invokePattern = $null
            try { $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked via InvokePattern"
                $clicked = $true
                break
            } else {
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter"
                $clicked = $true
                break
            }
        }
    } catch {}
}

if (-not $clicked) {
    Write-Host "omnistore.eu.org not found in page elements. Reading page..."
    $allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $found = @()
    foreach ($el in $allElements) {
        try {
            $name = $el.Current.Name
            if ($name -and $name.Length -gt 2 -and $name.Length -lt 300) {
                if ($name -match 'omnistore|eu\.org|home|account|domain|DNS|zone') {
                    $found += "[$($el.Current.ControlType.ProgrammaticName)] $name"
                }
            }
        } catch {}
    }
    $found | Select-Object -First 20
}

Start-Sleep -Seconds 5

# Read the page after navigation
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
        if ($name -and $name.Length -gt 2 -and $name.Length -lt 300) {
            if ($name -match 'omnistore|eu\.org|NS|nameserver|DNS|delegation|record|CNAME|A |status|active|pending|error') {
                $found += "[$($el.Current.ControlType.ProgrammaticName)] $name"
            }
        }
    } catch {}
}
Write-Host "=== Zone page elements ==="
$found | Select-Object -First 30
