Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            Write-Output "=== Chrome window: $name ==="
            $tree = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $count = 0
            foreach ($el in $tree) {
                try {
                    $ENAME = $el.Current.Name
                    $ECLASS = $el.Current.ClassName
                    if ($ENAME -and $ENAME.Length -gt 2) {
                        $line = "  [$ECLASS] $ENAME"
                        Write-Output $line
                        $count++
                        if ($count -gt 50) { break }
                    }
                } catch {}
            }
        }
    } catch {}
}
