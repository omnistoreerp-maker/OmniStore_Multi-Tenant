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

# Step 1: Find the Host edit field and set it via keyboard
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -eq 'Host') {
            Write-Host "Found Host field"
            $el.SetFocus()
            Start-Sleep -Milliseconds 300
            # Select all text and replace
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait("cairotech")
            Start-Sleep -Milliseconds 300
            Write-Host "Typed cairotech in Host"
            break
        }
    } catch {}
}

# Step 2: Find Container combobox and select giize.com via keyboard
# First tab to the combobox
[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
Start-Sleep -Milliseconds 200

# The combobox should now be focused - select giize.com
# Try clicking the dropdown first
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            Write-Host "Found ComboBox"
            $el.SetFocus()
            Start-Sleep -Milliseconds 200
            
            # Try SelectionItemPattern
            try {
                $selItems = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                if ($selItems) {
                    Write-Host "Has SelectionPattern"
                }
            } catch {}
            
            # Try ExpandCollapsePattern
            try {
                $ecp = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                if ($ecp) {
                    $ecp.Expand()
                    Write-Host "Expanded dropdown"
                    Start-Sleep -Milliseconds 500
                }
            } catch {
                Write-Host "No ExpandCollapse pattern"
            }
            break
        }
    } catch {}
}

# Step 3: Find giize.com in the list and select it
$allElements3 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements3) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($name -eq 'giize.com' -and $type -eq 'ControlType.ListItem') {
            Write-Host "Found giize.com in dropdown"
            try {
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                $el.Click()
                Write-Host "Selected giize.com"
            } catch {
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter on giize.com"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 1

# Step 4: Verify form state
Write-Host "`n=== Verifying form state ==="
$allElements4 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements4) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -eq 'Host') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "Host = $($vp.Current.Value)" }
        }
        if ($type -eq 'ControlType.ComboBox') {
            try {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) { Write-Host "Container = $($vp.Current.Value)" }
            } catch {}
        }
    } catch {}
}

# Step 5: Now find and click the Add button
Write-Host "`n=== Clicking Add button ==="
$allElements5 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements5) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Button' -and $name -and $name -match 'Add') {
            Write-Host "Found: $name"
            $invokePattern = $null
            try { $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked Add"
            } else {
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter on Add"
            }
            break
        }
    } catch {}
}
