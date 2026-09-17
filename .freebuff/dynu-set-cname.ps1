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

# Step 1: Find the Type combobox and change to CNAME
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -and $vp.Current.Value -eq 'A - IPv4') {
                Write-Host "Found Type combobox with value 'A - IPv4'"
                # Try to set value directly
                try {
                    $vp.SetValue("CNAME - Canonical Name")
                    Write-Host "Set to CNAME via ValuePattern"
                } catch {
                    Write-Host "ValuePattern failed, trying keyboard"
                    $el.SetFocus()
                    Start-Sleep -Milliseconds 200
                    # Open dropdown
                    try {
                        $ecp = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                        if ($ecp) { $ecp.Expand(); Write-Host "Expanded" }
                    } catch {}
                    Start-Sleep -Milliseconds 300
                }
                break
            }
        }
    } catch {}
}

Start-Sleep -Seconds 1

# Step 2: Try to find CNAME option in expanded dropdown
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($name -and $name -match 'CNAME' -and $type -eq 'ControlType.ListItem') {
            Write-Host "Found CNAME list item: $name"
            try { $el.SetFocus(); Start-Sleep -Milliseconds 200; $el.Click(); Write-Host "Clicked CNAME" } catch {
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter on CNAME"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 1

# Step 3: Verify type changed
Write-Host "`n=== Verifying form ==="
$allElements3 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements3) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name) {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "Edit: name='$name' value='$($vp.Current.Value)'" }
        }
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "ComboBox: value='$($vp.Current.Value)'" }
        }
    } catch {}
}
