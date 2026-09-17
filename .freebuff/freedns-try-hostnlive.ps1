Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) { Write-Host "No Chrome"; exit 1 }
$chrome.SetFocus()
Start-Sleep -Milliseconds 300

# Fill form: Type = CNAME
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$combos = @()
$edits = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $combos += $el
        }
        if ($type -eq 'ControlType.Edit') {
            $name = $el.Current.Name
            if ($name -and $name -match 'Subdomain|Destination|Type|Domain') {
                $edits += $el
            }
        }
    } catch {}
}

Write-Host "Found $($combos.Count) combo boxes, $($edits.Count) matched edit fields"

# The form has: Type (combo or edit), Subdomain (edit), Domain (combo), Destination (edit)
# Let me read all edit fields
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Edit') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            $name = $el.Current.Name
            $automationId = $el.Current.AutomationId
            if ($vp) {
                $val = $vp.Current.Value
                Write-Host "Edit: Name='$name' ID='$automationId' Value='$val'"
            }
        }
    } catch {}
}

# Read combo box values
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $name = $el.Current.Name
            try {
                $selItem = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                if ($selItem) {
                    $selected = $selItem.Current.SelectionItem.Current.Name
                    Write-Host "ComboBox: Name='$name' Selected='$selected'"
                }
            } catch {
                Write-Host "ComboBox: Name='$name' (could not read selection)"
            }
        }
    } catch {}
}
