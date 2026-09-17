param(
    [string]$Url = "https://freedns.afraid.org/subdomain/"
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '') {
            # Activate the Chrome window
            $w.SetFocus()
            Start-Sleep -Milliseconds 500
            
            # Open new tab with Ctrl+T
            [System.Windows.Forms.SendKeys]::SendWait("^t")
            Start-Sleep -Milliseconds 500
            
            # Type the URL
            # First make sure address bar is focused (Ctrl+L or F6)
            [System.Windows.Forms.SendKeys]::SendWait("^l")
            Start-Sleep -Milliseconds 300
            
            # Clear and type URL
            [System.Windows.Forms.SendKeys]::SendWait("{DELETE}")
            Start-Sleep -Milliseconds 100
            
            # Use clipboard to paste URL (more reliable than SendKeys for long strings)
            [System.Windows.Forms.Clipboard]::SetText($Url)
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait("^v")
            Start-Sleep -Milliseconds 200
            
            # Press Enter
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            
            Write-Output "Navigating to: $Url"
            Write-Output "Waiting for page load..."
            Start-Sleep -Seconds 5
            
            # Read the page content
            $allElements = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $foundDoc = $false
            foreach ($el in $allElements) {
                try {
                    $ECONTROL = $el.Current.ControlType.ProgrammaticName
                    $ENAME = $el.Current.Name
                    if ($ECONTROL -eq 'ControlType.Document' -and $ENAME -and $ENAME.Length -gt 3) {
                        Write-Output "=== DOCUMENT: $ENAME ==="
                        $foundDoc = $true
                    }
                    if ($ECONTROL -eq 'ControlType.Edit' -and $ename -match 'search|address') {
                        # skip address bar
                    }
                    if ($ECONTROL -eq 'ControlType.Hyperlink' -and $ENAME) {
                        Write-Output "LINK: $ENAME"
                    }
                    if ($ECONTROL -eq 'ControlType.Text' -and $ENAME -and $ENAME.Length -gt 2) {
                        Write-Output "TEXT: $ENAME"
                    }
                    if ($ECONTROL -eq 'ControlType.DataItem' -and $ENAME) {
                        Write-Output "DATA: $ENAME"
                    }
                    if ($ECONTROL -eq 'ControlType.Button' -and $ENAME -and $ENAME.Length -gt 2 -and $ENAME -notmatch 'Close|Minimize|Restore|Chrome|Back|Forward|Reload|Bookmark|Extension|Tab|New Tab|Gemini') {
                        Write-Output "BTN: $ENAME"
                    }
                } catch {}
            }
            break
        }
    } catch {}
}
