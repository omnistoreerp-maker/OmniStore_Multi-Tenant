Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Find the BrowserRootView
            $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'BrowserRootView')
            $browserRoot = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
            if ($browserRoot) {
                # Find all text elements in the content area
                $allElements = $browserRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                $count = 0
                foreach ($el in $allElements) {
                    try {
                        $ENAME = $el.Current.Name
                        $ECLASS = $el.Current.ClassName
                        $ECONTROL = $el.Current.ControlType.ProgrammaticName
                        if ($ENAME -and $ENAME.Length -gt 1) {
                            $line = "[$ECONTROL] [$ECLASS] $ENAME"
                            Write-Output $line
                            $count++
                            if ($count -gt 100) { break }
                        }
                    } catch {}
                }
            }
        }
    } catch {}
}
