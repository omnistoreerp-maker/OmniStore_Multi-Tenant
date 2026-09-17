Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -ne 'Freebuff Desktop' -and $w.Current.Name -ne '') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) { Write-Output "ERROR: Chrome not found"; exit 1 }

# Find all form elements
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

# Find ComboBox elements (Type and Domain dropdowns)
$comboBoxes = @()
foreach ($el in $allElements) {
    try {
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ECONTROL -eq 'ControlType.ComboBox') {
            $rect = $el.Current.BoundingRectangle
            $comboBoxes += $el
            Write-Output "ComboBox found: X=$($rect.X) Y=$($rect.Y) W=$($rect.Width) H=$($rect.Height)"
            
            # Try to read current value
            try {
                $selPattern = $el.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
                $current = $selPattern.Current.GetSelection()
                if ($current.Length -gt 0) {
                    Write-Output "  Current selection: $($current[0].Current.Name)"
                }
            } catch {}
            
            # Try to read all options
            try {
                $expandPattern = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
                Write-Output "  ExpandCollapse available, State: $($expandPattern.Current.ExpandCollapseState)"
            } catch {}
        }
    } catch {}
}

Write-Output "Total ComboBoxes found: $($comboBoxes.Count)"

# Find Edit fields
foreach ($el in $allElements) {
    try {
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        $ENAME = $el.Current.Name
        if ($ECONTROL -eq 'ControlType.Edit') {
            $rect = $el.Current.BoundingRectangle
            try {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                Write-Output "Edit: X=$($rect.X) Y=$($rect.Y) Name='$ENAME' Value='$($vp.Current.Value)'"
            } catch {
                Write-Output "Edit: X=$($rect.X) Y=$($rect.Y) Name='$ENAME'"
            }
        }
    } catch {}
}
