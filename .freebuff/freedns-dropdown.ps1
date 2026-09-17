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

# Navigate to FreeDNS add subdomain form
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $vp.SetValue("https://freedns.afraid.org/subdomain/edit.php")
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Read all combo boxes and their options
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
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $name = $el.Current.Name
            Write-Host "COMBOBOX: $name"
            # Try to read all items
            try {
                $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                if ($selPattern) {
                    $items = $selPattern.Current.GetSelection
                    foreach ($item in $items) {
                        Write-Host "  Item: $($item.Current.Name)"
                    }
                }
            } catch { Write-Host "  Could not read items" }
        }
        if ($type -eq 'ControlType.ListItem') {
            $name = $el.Current.Name
            if ($name -and $name.Length -gt 1) {
                # Could be a dropdown option
            }
        }
    } catch {}
}

# Also look for list items that might be dropdown options
Write-Host "=== Looking for domain list items ==="
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$domains = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ListItem' -and $name -and $name.Length -gt 2) {
            $domains += $name
        }
    } catch {}
}
$domains | Select-Object -First 30
