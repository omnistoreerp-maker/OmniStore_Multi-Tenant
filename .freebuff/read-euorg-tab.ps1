Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Find the tab with "Domain List"
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    if ($ENAME -and $ENAME -match 'Domain List for OS773') {
                        Write-Output "=== Found tab: $ENAME ==="
                        # Try to get the AutomationId or focus
                        $autoId = $el.Current.AutomationId
                        Write-Output "  AutomationId: $autoId"
                        # Try to select/focus this tab
                        $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                        if ($invokePattern) {
                            Write-Output "  InvokePattern available"
                        }
                    }
                } catch {}
            }

            # Also get the bounding rectangle and try to screenshot
            $rect = $w.Current.BoundingRectangle
            Write-Output "=== Window bounding: $($rect.X), $($rect.Y), $($rect.Width), $($rect.Height) ==="

            # Find the address bar content to confirm which URL is loaded
            $addressCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
            $addressBar = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
            if ($addressBar) {
                $addrVal = $addressBar.Current.Name
                Write-Output "=== Address bar: $addrVal ==="
                # Try to read the value pattern
                try {
                    $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $currentValue = $vp.Current.Value
                    Write-Output "=== Current URL: $currentValue ==="
                } catch {
                    Write-Output "  (ValuePattern not available)"
                }
            }
        }
    } catch {}
}
