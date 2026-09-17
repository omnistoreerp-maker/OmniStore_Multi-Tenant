Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient

# Find Chrome window
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
    Write-Output "ERROR: Chrome window not found"
    exit 1
}

# Activate Chrome
$chrome.SetFocus()
Start-Sleep -Milliseconds 500

# Open new tab
[System.Windows.Forms.SendKeys]::SendWait("^t")
Start-Sleep -Milliseconds 1000

# Focus address bar
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500

# Clear existing text
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("{DELETE}")
Start-Sleep -Milliseconds 100

# Paste URL from clipboard
[System.Windows.Forms.Clipboard]::SetText("https://freedns.afraid.org/subdomain/")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 300

# Navigate
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 5

Write-Output "Navigation complete. Reading page..."

# Read page content
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$count = 0
foreach ($el in $allElements) {
    try {
        $ENAME = $el.Current.Name
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ENAME -and $ENAME.Length -gt 2) {
            if ($ECONTROL -match 'Document|Hyperlink|Text|DataItem|Edit') {
                if ($ECONTROL -notmatch 'Edit' -or $ENAME -match 'search|address') {
                    # skip most edits
                } else {
                    continue
                }
                Write-Output "[$ECONTROL] $ENAME"
                $count++
                if ($count -gt 50) { break }
            }
        }
    } catch {}
}
