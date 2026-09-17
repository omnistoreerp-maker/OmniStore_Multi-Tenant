Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Get all elements and look for text content
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $textItems = @()
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    $EAID = $el.Current.AutomationId
                    if ($ENAME -and $ENAME.Length -gt 0) {
                        # Skip chrome UI elements
                        if ($ECONTROL -ne 'ControlType.Window' -and 
                            $ECONTROL -ne 'ControlType.Button' -and
                            $ECONTROL -ne 'ControlType.ToolBar' -and
                            $ECONTROL -ne 'ControlType.Separator' -and
                            $ECONTROL -ne 'ControlType.TabItem' -and
                            $ECONTROL -ne 'ControlType.MenuItem') {
                            $textItems += "$ECONTROL | $ENAME"
                        }
                    }
                } catch {}
            }
            foreach ($t in $textItems) {
                Write-Output $t
            }
        }
    } catch {}
}
