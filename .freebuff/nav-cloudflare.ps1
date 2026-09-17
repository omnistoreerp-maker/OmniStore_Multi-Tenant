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

# Find address bar and navigate
$addrCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
$addressBar = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addrCondition)

if ($addressBar) {
    try {
        $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $vp.SetValue("https://dash.cloudflare.com/")
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Seconds 8
    } catch {
        Write-Output "ValuePattern failed"
        exit 1
    }
}

# Read page
Write-Output "=== CLOUDFLARE PAGE ==="
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$count = 0
foreach ($el in $allElements) {
    try {
        $ENAME = $el.Current.Name
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ENAME -and $ENAME.Length -gt 1 -and $ECONTROL -ne 'ControlType.Window' -and $ECONTROL -ne 'ControlType.ToolBar' -and $ECONTROL -ne 'ControlType.Separator' -and $ECONTROL -ne 'ControlType.TabItem' -and $ECONTROL -ne 'ControlType.Button') {
            Write-Output "[$ECONTROL] $ENAME"
            $count++
            if ($count -gt 80) { break }
        }
    } catch {}
}
