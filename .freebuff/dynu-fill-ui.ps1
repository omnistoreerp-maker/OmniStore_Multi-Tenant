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

# Find all edit fields
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$hostField = $null
$domainField = $null
$comboField = $null

foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name) {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $val = $vp.Current.Value
                Write-Host "Edit: name='$name' value='$val'"
                if ($name -eq 'Host' -or ($val -eq 'omnistoreerp' -and $name -ne 'Address and search bar')) {
                    $hostField = $el
                }
            }
        }
        if ($type -eq 'ControlType.ComboBox') {
            $bounds = $el.Current.BoundingRectangle
            Write-Host "ComboBox at ($([int]$bounds.X),$([int]$bounds.Y))"
            $comboField = $el
        }
    } catch {}
}

# Fill Host field
if ($hostField) {
    Write-Host "Setting Host to 'cairotech'..."
    try {
        $vp = $hostField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp) {
            $vp.SetValue("cairotech")
            Write-Host "Host set"
        }
    } catch {
        $hostField.SetFocus()
        Start-Sleep -Milliseconds 200
        # Select all and type
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.SendKeys]::SendWait("cairotech")
        Write-Host "Host typed"
    }
}

# Try to find and set the Container dropdown
if ($comboField) {
    Write-Host "Setting Container dropdown..."
    try {
        $vp = $comboField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        if ($vp) {
            $vp.SetValue("giize.com")
            Write-Host "Container set to giize.com"
        }
    } catch {
        Write-Host "Could not set via ValuePattern"
    }
}

Start-Sleep -Seconds 1

# Now look for Add/Submit button
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Button' -and $name -and $name -match 'Add|Submit|Save|Create') {
            $bounds = $el.Current.BoundingRectangle
            Write-Host "Found button: '$name' at ($([int]$bounds.X),$([int]$bounds.Y))"
        }
    } catch {}
}
