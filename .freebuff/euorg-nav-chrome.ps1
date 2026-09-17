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
        $class = $w.Current.ClassName
        $name = $w.Current.Name
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop') {
            $chrome = $w
            Write-Host "Found Chrome: $name"
            break
        }
    } catch {}
}

if (-not $chrome) {
    Write-Host "Chrome not found"
    exit 1
}

# Find the URL bar
$urlBar = $chrome.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "10018"
    )
)

if (-not $urlBar) {
    Write-Host "URL bar not found, trying alternative..."
    $urlBar = $chrome.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ClassNameProperty,
            "Edit"
        )
    )
}

if ($urlBar) {
    Write-Host "URL bar found"
    
    # Click on URL bar first
    try { $urlBar.SetFocus() } catch {}
    Start-Sleep -Milliseconds 300
    
    # Select all and type URL
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 300
    
    $valuePattern = $urlBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($valuePattern) {
        $valuePattern.SetValue("https://nic.eu.org/arf/en/")
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Host "Navigating to EU.org..."
        Start-Sleep -Seconds 6
        
        # Read the page content
        Write-Host "`n=== EU.ORG PAGE CONTENT ==="
        $allElements = $chrome.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.Condition]::TrueCondition
        )
        
        $textItems = @()
        foreach ($el in $allElements) {
            try {
                $elName = $el.Current.Name
                $controlType = $el.Current.ControlType.ProgrammaticName
                if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 300) {
                    $textItems += "[$controlType] $elName"
                }
            } catch {}
        }
        
        $textItems | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "ValuePattern not available"
    }
} else {
    Write-Host "URL bar not found at all"
}
