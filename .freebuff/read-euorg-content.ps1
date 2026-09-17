Add-Type -AssemblyName UIAutomationClient
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Find all text elements deeper in the tree
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $textElements = @()
            foreach ($el in $allElements) {
                try {
                    $ENAME = $el.Current.Name
                    $ECLASS = $el.Current.ClassName
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    # Look for text content that could be EU.org data
                    if ($ENAME -and $ENAME.Length -gt 1 -and 
                        ($ENAME -match 'eu.org' -or $ENAME -match 'domain' -or $ENAME -match 'Domain' -or
                         $ENAME -match 'FREE' -or $ENAME -match 'Status' -or $ENAME -match 'Created' -or
                         $ENAME -match 'Pending' -or $ENAME -match 'Approved' -or $ENAME -match 'Refused' -or
                         $ENAME -match 'OS773' -or $ENAME -match 'cairotech' -or $ENAME -match 'Request' -or
                         $ECONTROL -eq 'ControlType.DataItem' -or $ECONTROL -eq 'ControlType.Text')) {
                        $textElements += "[$ECONTROL] $ECLASS : $ENAME"
                    }
                } catch {}
            }
            foreach ($t in $textElements) {
                Write-Output $t
            }
        }
    } catch {}
}
