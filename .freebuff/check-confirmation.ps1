Add-Type -AssemblyName UIAutomationClient

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

# Find the Google Chrome window (not Brave)
foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '' -and $name -notmatch 'Brave') {
            Write-Output "=== Found Chrome window: $name ==="
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            
            # Find "The process has begun!" tab and click it
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    if ($ECONTROL -eq 'ControlType.TabItem' -and $ENAME -match 'process has begun') {
                        Write-Output "Found confirmation tab: $ENAME"
                        try {
                            $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                            $ip.Invoke()
                            Write-Output "Clicked tab"
                            Start-Sleep -Seconds 3
                        } catch {
                            try {
                                $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                                $sp.Select()
                                Write-Output "Selected tab"
                                Start-Sleep -Seconds 3
                            } catch {}
                        }
                        break
                    }
                } catch {}
            }
            
            # Read page content
            Write-Output "=== PAGE CONTENT ==="
            $allElements2 = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $count = 0
            foreach ($el in $allElements2) {
                try {
                    $ENAME = $el.Current.Name
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    if ($ECONTROL -eq 'ControlType.Document') {
                        Write-Output "DOCUMENT: $ENAME"
                    }
                    if ($ECONTROL -eq 'ControlType.Text' -and $ENAME -and $ENAME.Length -gt 3) {
                        Write-Output "TEXT: $ENAME"
                        $count++
                    }
                    if ($ECONTROL -eq 'ControlType.DataItem' -and $ENAME -and $ENAME.Length -gt 3) {
                        Write-Output "DATA: $ENAME"
                        $count++
                    }
                    if ($count -gt 30) { break }
                } catch {}
            }
            break
        }
    } catch {}
}
