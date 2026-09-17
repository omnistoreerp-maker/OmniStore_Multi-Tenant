Add-Type -AssemblyName UIAutomationClient
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
                        Write-Output "Found tab: $ENAME"
                        # Try InvokePattern to click/activate the tab
                        try {
                            $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                            $invokePattern.Invoke()
                            Write-Output "Tab activated via InvokePattern"
                        } catch {
                            Write-Output "InvokePattern failed, trying ExpandCollapse..."
                            try {
                                $expandPattern = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                                $expandPattern.Expand()
                                Write-Output "Tab activated via ExpandCollapse"
                            } catch {
                                Write-Output "Trying SelectionItemPattern..."
                                try {
                                    $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                                    $selPattern.Select()
                                    Write-Output "Tab activated via Select"
                                } catch {
                                    Write-Output "All patterns failed"
                                }
                            }
                        }
                        break
                    }
                } catch {}
            }

            # Now read the address bar
            Start-Sleep -Seconds 1
            $addressCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
            $addressBar = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressCondition)
            if ($addressBar) {
                try {
                    $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $currentValue = $vp.Current.Value
                    Write-Output "=== URL: $currentValue ==="
                } catch {
                    Write-Output "Could not read URL"
                }
            }
        }
    } catch {}
}
