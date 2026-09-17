Add-Type -AssemblyName UIAutomationClient

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '' -and $name -notmatch 'Brave') {
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            foreach ($el in $allElements) {
                try {
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    if ($ECONTROL -eq 'ControlType.ComboBox') {
                        $rect = $el.Current.BoundingRectangle
                        try {
                            $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                            $items = $sel.Current.GetSelection()
                            if ($items.Length -gt 0) {
                                Write-Output "ComboBox Y=$($rect.Y): Selected = $($items[0].Current.Name)"
                            } else {
                                Write-Output "ComboBox Y=$($rect.Y): No selection"
                            }
                        } catch {
                            Write-Output "ComboBox Y=$($rect.Y): Cannot read selection"
                        }
                    }
                    if ($ECONTROL -eq 'ControlType.Edit') {
                        $rect = $el.Current.BoundingRectangle
                        try {
                            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                            if ($rect.Y -gt 390 -and $rect.Y -lt 470) {
                                Write-Output "Edit Y=$($rect.Y): Value = $($vp.Current.Value)"
                            }
                        } catch {}
                    }
                    if ($ECONTROL -eq 'ControlType.DataItem' -and $el.Current.Name -match 'mooo|privatedns|chickenkiller|strangled') {
                        Write-Output "Domain visible: $($el.Current.Name)"
                    }
                } catch {}
            }
            break
        }
    } catch {}
}
