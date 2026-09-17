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

# Navigate back to DNS Records page
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

# Find the Type combobox and interact via keyboard
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -and $vp.Current.Value -eq 'A - IPv4') {
                Write-Host "Found Type combobox"
                $el.SetFocus()
                Start-Sleep -Milliseconds 300
                
                # Try SelectionItemPattern to select CNAME
                try {
                    $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                    if ($selPattern) {
                        $items = $selPattern.Current.GetSelection
                        Write-Host "Current selection items: $($items.Count)"
                    }
                } catch {}
                
                # Try to list all items in the combobox
                try {
                    $itemsPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                } catch {}
                
                # Open dropdown with Alt+Down
                [System.Windows.Forms.SendKeys]::SendWait("%{DOWN}")
                Start-Sleep -Milliseconds 500
                
                # Type "C" to jump to CNAME
                [System.Windows.Forms.SendKeys]::SendWait("c")
                Start-Sleep -Milliseconds 300
                
                # Check if CNAME is now selected
                $vp2 = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp2) { Write-Host "After keyboard: $($vp2.Current.Value)" }
                
                # Try pressing Enter to confirm
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Start-Sleep -Milliseconds 300
                
                # Check again
                $vp3 = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp3) { Write-Host "After Enter: $($vp3.Current.Value)" }
                
                break
            }
        }
    } catch {}
}

# Now check what fields are visible
Write-Host "`n=== Current form fields ==="
$allElements3 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements3) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 0) {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "Edit: name='$name' value='$($vp.Current.Value)'" }
        }
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "ComboBox: value='$($vp.Current.Value)'" }
        }
    } catch {}
}
