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

if (-not $chrome) {
    Write-Output "ERROR: Chrome not found"
    exit 1
}

# Open new tab
$chrome.SetFocus()
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("^t")
Start-Sleep -Milliseconds 1000

# Find address bar
$addrCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
$addressBar = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addrCondition)

if ($addressBar) {
    Write-Output "Found address bar"
    try {
        $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $vp.SetValue("https://freedns.afraid.org/subdomain/")
        Write-Output "URL set via ValuePattern"
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Write-Output "Enter pressed"
        Start-Sleep -Seconds 6
    } catch {
        Write-Output "ValuePattern failed: $_"
        # Fallback: click + type
        $addressBar.SetFocus()
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("^a")
        Start-Sleep -Milliseconds 100
        [System.Windows.Forms.Clipboard]::SetText("https://freedns.afraid.org/subdomain/")
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        Start-Sleep -Seconds 6
    }
} else {
    Write-Output "Address bar not found"
    exit 1
}

# Read page content
Write-Output "=== PAGE CONTENT ==="
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$count = 0
foreach ($el in $allElements) {
    try {
        $ENAME = $el.Current.Name
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ENAME -and $ENAME.Length -gt 1 -and $ECONTROL -ne 'ControlType.Window' -and $ECONTROL -ne 'ControlType.ToolBar' -and $ECONTROL -ne 'ControlType.Separator' -and $ECONTROL -ne 'ControlType.TabItem' -and $ECONTROL -ne 'ControlType.Button') {
            Write-Output "[$ECONTROL] $ENAME"
            $count++
            if ($count -gt 60) { break }
        }
    } catch {}
}
