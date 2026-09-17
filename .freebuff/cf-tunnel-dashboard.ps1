Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

# Find Chrome windows
$chromeWindows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -notlike '*YouTube*' -and $name -notlike '*ChatGPT*') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) {
    Write-Host "Chrome not found"
    exit 1
}

# Focus Chrome
$chrome.SetFocus()
Start-Sleep -Milliseconds 500

# Navigate to Cloudflare dashboard tunnels page
$chromeUrl = $chrome.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "10018"
    )
)

if ($chromeUrl) {
    $chromeUrl.SetFocus()
    Start-Sleep -Milliseconds 300
    
    # Type the URL
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 300
    
    $valuePattern = $chromeUrl.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($valuePattern) {
        $valuePattern.SetValue("https://one.dash.cloudflare.com/?account_id#/networks/tunnels")
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Host "Navigating to Cloudflare Zero Trust tunnels page..."
        Start-Sleep -Seconds 5
    }
} else {
    Write-Host "URL bar not found, trying alternative approach"
    # Try Ctrl+L
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 500
}

# Now read the page content
Start-Sleep -Seconds 3
Write-Host "=== Current URL ==="

# Try to read all text elements
$allElements = $chrome.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
)

$textElements = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and $name.Length -gt 2 -and $name.Length -lt 200) {
            $textElements += $name
        }
    } catch {}
}

Write-Host "=== Page elements (first 50) ==="
$textElements | Select-Object -First 50 | ForEach-Object { Write-Host $_ }
