Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

# First, let me find the Chrome window and the form
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

# The form has these fields (based on earlier analysis):
# 1. Type combobox (CNAME/A/MX/etc)
# 2. Subdomain edit
# 3. Domain combobox (mooo.com, hostnlive.com, etc)
# 4. Destination edit
# 5. CAPTCHA
# 
# The combo boxes have no accessible names, so I'll use Tab navigation.
# Let me first click on the Subdomain edit field to anchor, then work from there.

$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

# Find the Subdomain edit field (it should have placeholder "your.domain.com" or be near the Type combobox)
$editFields = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Edit') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $val = $vp.Current.Value
                $bounds = $el.Current.BoundingRectangle
                $editFields += @{
                    Element = $el
                    Value = $val
                    X = [int]$bounds.X
                    Y = [int]$bounds.Y
                    Width = [int]$bounds.Width
                    Height = [int]$bounds.Height
                }
                Write-Host "Edit: Value='$val' at ($([int]$bounds.X),$([int]$bounds.Y)) size ($([int]$bounds.Width)x$([int]$bounds.Height))"
            }
        }
    } catch {}
}

# Find the combo boxes
$comboBoxes = @()
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.ComboBox') {
            $bounds = $el.Current.BoundingRectangle
            $comboBoxes += @{
                Element = $el
                X = [int]$bounds.X
                Y = [int]$bounds.Y
                Width = [int]$bounds.Width
                Height = [int]$bounds.Height
            }
            Write-Host "ComboBox at ($([int]$bounds.X),$([int]$bounds.Y)) size ($([int]$bounds.Width)x$([int]$bounds.Height))"
        }
    } catch {}
}
