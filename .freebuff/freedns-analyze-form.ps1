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

# Navigate to FreeDNS add subdomain
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

# Read form elements
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

# Read the address bar to check current URL
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                Write-Host "URL: $($vp.Current.Value)"
            }
            break
        }
    } catch {}
}

# Find all combo boxes (dropdowns) and edit fields
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$combos = @()
$edits = @()
$buttons = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.ComboBox') {
            $combos += "Combo: $name"
            # Try to read selection
            try {
                $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if ($selPattern) {
                    $combos[$combos.Count-1] += " -> Selected: $($selPattern.Current.SelectionItem.Current.Name)"
                }
            } catch {}
        }
        if ($type -eq 'ControlType.Edit' -and $name) {
            $edits += "Edit: $name"
        }
        if ($type -eq 'ControlType.Button' -and $name -and $name.Length -gt 1) {
            $buttons += "Button: $name"
        }
    } catch {}
}

Write-Host "=== COMBO BOXES ==="
$combos
Write-Host "=== EDIT FIELDS ==="
$edits
Write-Host "=== BUTTONS ==="
$buttons | Select-Object -First 10

# Also read visible text for form context
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$found = @()
foreach ($el in $allElements) {
    try {
        $name = $el.Current.Name
        if ($name -and $name.Length -gt 1 -and $name.Length -lt 200) {
            if ($name -match 'adding|subdomain|type|domain|destination|captcha|save|CNAME|error|restrict|host|type') {
                $found += "[$($el.Current.ControlType.ProgrammaticName)] $name"
            }
        }
    } catch {}
}
Write-Host "=== FORM TEXT ==="
$found | Select-Object -First 20
