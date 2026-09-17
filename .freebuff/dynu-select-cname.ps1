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

# Find the Type combobox
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -and $vp.Current.Value -match 'CAA') {
                Write-Host "Found Type combobox with: $($vp.Current.Value)"
                $el.SetFocus()
                Start-Sleep -Milliseconds 300
                
                # Open dropdown
                [System.Windows.Forms.SendKeys]::SendWait("%{DOWN}")
                Start-Sleep -Milliseconds 500
                
                # Type "cn" to jump to CNAME
                [System.Windows.Forms.SendKeys]::SendWait("cn")
                Start-Sleep -Milliseconds 300
                
                # Check what's selected
                $vp2 = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp2) { Write-Host "After 'cn': $($vp2.Current.Value)" }
                
                # Press Enter to confirm
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Start-Sleep -Milliseconds 300
                
                # Final check
                $vp3 = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp3) { Write-Host "Final: $($vp3.Current.Value)" }
                
                break
            }
        }
    } catch {}
}

# Now check what fields are visible
Write-Host "`n=== Form fields ==="
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -and $name.Length -gt 0 -and $name -ne 'Address and search bar' -and $name -ne 'Search') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) { Write-Host "Edit: name='$name' value='$($vp.Current.Value)'" }
        }
        if ($type -eq 'ControlType.ComboBox') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp -and $vp.Current.Value -ne '25') { Write-Host "ComboBox: value='$($vp.Current.Value)'" }
        }
    } catch {}
}
