Add-Type -AssemblyName UIAutomationClient

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -ne 'Freebuff Desktop' -and $w.Current.Name -ne '') {
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    if ($ECONTROL -eq 'ControlType.Hyperlink' -and $ENAME -eq 'Add a subdomain') {
                        # Try to get the NavigatePattern
                        try {
                            $np = $el.GetCurrentPattern([System.Windows.Automation.NavigatePattern]::Pattern)
                            $target = $np.GetNavigateTarget([System.Windows.Automation.NavigationDirection]::Parent)
                            Write-Output "Navigate target found"
                        } catch {}
                        
                        # Try to get the LegacyIAccessiblePattern for URL
                        try {
                            $legacy = $el.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
                            Write-Output "Legacy pattern value: $($legacy.Current.Value)"
                        } catch {}
                        
                        # Get bounding rect
                        $rect = $el.Current.BoundingRectangle
                        Write-Output "Link bounding: X=$($rect.X) Y=$($rect.Y) W=$($rect.Width) H=$($rect.Height)"
                        
                        # Try InvokePattern
                        try {
                            $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                            $ip.Invoke()
                            Write-Output "Invoked!"
                            Start-Sleep -Seconds 5
                        } catch {
                            Write-Output "InvokePattern not available: $_"
                        }
                        break
                    }
                } catch {}
            }
            break
        }
    } catch {}
}

# Read page after invoke
Write-Output "=== AFTER INVOKE ==="
$chrome2 = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -ne 'Freebuff Desktop' -and $w.Current.Name -ne '') {
            $chrome2 = $w
            break
        }
    } catch {}
}
if ($chrome2) {
    $allElements = $chrome2.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $count = 0
    foreach ($el in $allElements) {
        try {
            $ENAME = $el.Current.Name
            $ECONTROL = $el.Current.ControlType.ProgrammaticName
            if ($ENAME -and $ENAME.Length -gt 1 -and $ECONTROL -ne 'ControlType.Window' -and $ECONTROL -ne 'ControlType.ToolBar' -and $ECONTROL -ne 'ControlType.Separator' -and $ECONTROL -ne 'ControlType.TabItem' -and $ECONTROL -ne 'ControlType.Button') {
                Write-Output "[$ECONTROL] $ENAME"
                $count++
                if ($count -gt 120) { break }
            }
        } catch {}
    }
}
