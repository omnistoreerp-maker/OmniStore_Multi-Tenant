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

# Read all elements more carefully - find combo boxes by walking parent tree
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$comboIndex = 0
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $bounds = $el.Current.BoundingRectangle
            Write-Host "Combo$comboIndex at: X=$($bounds.X) Y=$($bounds.Y) W=$($bounds.Width) H=$($bounds.Height)"
            
            # Try ValuePattern first
            try {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) {
                    Write-Host "  ValuePattern value: $($vp.Current.Value)"
                }
            } catch {}
            
            # Try SelectionPattern
            try {
                $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                if ($sp) {
                    $items = $sp.Current.GetSelection
                    Write-Host "  Selection items: $($items.Count)"
                    foreach ($item in $items) {
                        Write-Host "    Selected: $($item.Current.Name)"
                    }
                }
            } catch {}
            
            # Try ExpandCollapsePattern
            try {
                $ecp = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                if ($ecp) {
                    Write-Host "  ExpandCollapse state: $($ecp.Current.ExpandCollapseState)"
                }
            } catch {}
            
            # Try legacy pattern
            try {
                $lp = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
                if ($lp) {
                    Write-Host "  Legacy value: $($lp.Current.Value)"
                    Write-Host "  Legacy name: $($lp.Current.Name)"
                    Write-Host "  Legacy state: $($lp.Current.State)"
                }
            } catch {}
            
            $comboIndex++
        }
    } catch {}
}
