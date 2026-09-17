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
        if ($class -eq 'Chrome_WidgetWin_1') {
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

# Focus Chrome
$chrome.SetFocus()
Start-Sleep -Milliseconds 500

# Open new tab with Ctrl+T
[System.Windows.Forms.SendKeys]::SendWait("^t")
Start-Sleep -Milliseconds 500

# Navigate to EU.org
$urlBar = $chrome.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "10018"
    )
)

if ($urlBar) {
    $urlBar.SetFocus()
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 300
    
    $valuePattern = $urlBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($valuePattern) {
        $valuePattern.SetValue("https://nic.eu.org/arf/en/")
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Host "Navigating to EU.org..."
        Start-Sleep -Seconds 5
    }
}

# Read all text content from the page
Write-Host "`n=== PAGE CONTENT ==="
$allElements = $chrome.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
)

$textContent = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        $controlType = $el.Current.ControlType.ProgrammaticName
        if ($name -and $name.Length -gt 1 -and $name.Length -lt 500) {
            $textContent += "[$controlType] $name"
        }
    } catch {}
}

$textContent | ForEach-Object { Write-Host $_ }

# Also check for any links
Write-Host "`n=== LINKS ==="
$linkElements = $chrome.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Hyperlink
    )
)

foreach ($link in $linkElements) {
    try {
        Write-Host "Link: $($link.Current.Name)"
    } catch {}
}

# Check for tables
Write-Host "`n=== TABLES ==="
$tableElements = $chrome.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Table
    )
)

foreach ($table in $tableElements) {
    try {
        Write-Host "Table found: $($table.Current.Name)"
        $rows = $table.FindAll(
            [System.Windows.Automation.TreeScope]::Children,
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::DataItem
            )
        )
        Write-Host "  Rows: $($rows.Count)"
        foreach ($row in $rows) {
            Write-Host "  Row: $($row.Current.Name)"
        }
    } catch {}
}
