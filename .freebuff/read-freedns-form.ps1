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
                    $EAID = $el.Current.AutomationId
                    if ($ECONTROL -eq 'ControlType.Image' -and $ENAME -match 'CAPTCHA') {
                        $rect = $el.Current.BoundingRectangle
                        Write-Output "CAPTCHA Image: X=$($rect.X) Y=$($rect.Y) W=$($rect.Width) H=$($rect.Height)"
                        # Try to get any accessible text
                        try {
                            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            Write-Output "CAPTCHA Value: $($vp.Current.Value)"
                        } catch {}
                    }
                    if ($ECONTROL -eq 'ControlType.Edit' -and $ENAME -match 'CAPTCHA') {
                        Write-Output "CAPTCHA Edit field found"
                    }
                    if ($ECONTROL -eq 'ControlType.ComboBox' -or ($ECONTROL -eq 'ControlType.List' -and $ENAME -match 'Domain|Type')) {
                        Write-Output "Dropdown: $ECONTROL - $ENAME"
                    }
                } catch {}
            }

            # Also get the current URL
            $addrCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
            $addressBar = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addrCondition)
            if ($addressBar) {
                try {
                    $vp2 = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    Write-Output "Current URL: $($vp2.Current.Value)"
                } catch {}
            }
            break
        }
    } catch {}
}
