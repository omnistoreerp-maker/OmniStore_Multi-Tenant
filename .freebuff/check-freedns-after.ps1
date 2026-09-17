Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '' -and $name -notmatch 'Brave') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) { Write-Output "ERROR: Chrome not found"; exit 1 }

$addrCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
$addressBar = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addrCondition)

if ($addressBar) {
    try {
        $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $vp.SetValue("https://freedns.afraid.org/subdomain/")
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Seconds 6
    } catch {}
}

Write-Output "=== FREEDNS SUBDOMAINS ==="
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$count = 0
foreach ($el in $allElements) {
    try {
        $ENAME = $el.Current.Name
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ECONTROL -eq 'ControlType.Document') {
            Write-Output "DOCUMENT: $ENAME"
        }
        if ($ENAME -and $ENAME.Length -gt 2 -and $ECONTROL -ne 'ControlType.Window' -and $ECONTROL -ne 'ControlType.ToolBar' -and $ECONTROL -ne 'ControlType.Separator' -and $ECONTROL -ne 'ControlType.TabItem' -and $ECONTROL -ne 'ControlType.Button') {
            Write-Output "[$ECONTROL] $ENAME"
            $count++
            if ($count -gt 150) { break }
        }
    } catch {}
}
