Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Look for the render widget which contains actual page content
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $foundRender = $false
            foreach ($el in $allElements) {
                try {
                    $ECLASS = $el.Current.ClassName
                    if ($ECLASS -match 'RenderWidget' -or $ECLASS -match 'ContentsView' -or $ECLASS -match 'WebContents') {
                        $foundRender = $true
                        Write-Output "=== Found render widget: $ECLASS ==="
                        # Read children of render widget
                        $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
                        $count = 0
                        foreach ($child in $children) {
                            try {
                                $CNAME = $child.Current.Name
                                $CCLASS = $child.Current.ClassName
                                $CCONTROL = $child.Current.ControlType.ProgrammaticName
                                if ($CNAME -and $CNAME.Length -gt 0) {
                                    Write-Output "  [$CCONTROL] $CCLASS : $CNAME"
                                    $count++
                                    if ($count -gt 50) { break }
                                }
                            } catch {}
                        }
                    }
                } catch {}
            }
            if (-not $foundRender) {
                Write-Output "No render widget found. Listing all unique class names:"
                $classes = @{}
                foreach ($el in $allElements) {
                    try {
                        $ECLASS = $el.Current.ClassName
                        if ($ECLASS -and -not $classes.ContainsKey($ECLASS)) {
                            $classes[$ECLASS] = $true
                            Write-Output "  Class: $ECLASS"
                        }
                    } catch {}
                }
            }
        }
    } catch {}
}
