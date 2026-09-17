Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $allWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '' -and $name -notmatch 'Google Chrome') {
            Write-Output "=== Window: $name (class: $class) ==="
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $tabCount = 0
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    if ($ECONTROL -eq 'ControlType.TabItem' -and $ENAME -and $ENAME.Length -gt 3) {
                        Write-Output "  TAB: $ENAME"
                        $tabCount++
                    }
                } catch {}
            }
            if ($tabCount -eq 0) {
                # Maybe it's Edge with different class
                Write-Output "  (no tabs found via TabItem, trying other elements)"
                foreach ($el in $allElements) {
                    try {
                        $ENAME = $el.Current.Name
                        if ($ENAME -and $ENAME.Length -gt 5 -and ($ENAME -match 'freedns\|cloudflare\|dns\|tunnel')) {
                            Write-Output "  FOUND: $ENAME"
                        }
                    } catch {}
                }
            }
        }
    } catch {}
}

# Also check for Edge specifically
Write-Output "`n=== Checking all windows for Edge ==="
foreach ($w in $allWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($name -and ($name -match 'Edge' -or $name -match 'edge')) {
            Write-Output "Edge window: $name (class: $class)"
        }
    } catch {}
}
