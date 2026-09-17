Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Get ALL elements with names, including those with AutomationId
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $count = 0
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    $EAID = $el.Current.AutomationId
                    $EBRect = $el.Current.BoundingRectangle
                    
                    if ($ENAME -and $ENAME.Length -gt 0) {
                        # Output everything - we need to see ALL elements
                        $line = "$ECONTROL | AID=$EAID | Name=$ENAME | Rect=$($EBRect.X),$($EBRect.Y)"
                        Write-Output $line
                        $count++
                        if ($count -gt 200) { break }
                    }
                } catch {}
            }
        }
    } catch {}
}
