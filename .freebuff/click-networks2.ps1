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

# Find "Networks" and get its bounding rectangle
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $ENAME = $el.Current.Name
        $ECONTROL = $el.Current.ControlType.ProgrammaticName
        if ($ECONTROL -eq 'ControlType.ListItem' -and $ENAME -eq 'Networks') {
            $rect = $el.Current.BoundingRectangle
            Write-Output "Networks ListItem: X=$($rect.X) Y=$($rect.Y) W=$($rect.Width) H=$($rect.Height)"
            
            # Click it
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class ClickHelper {
                [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
                public static void Click(int x, int y) {
                    mouse_event(0x0002, x, y, 0, 0);
                    System.Threading.Thread.Sleep(50);
                    mouse_event(0x0004, x, y, 0, 0);
                }
            }
"@
            $x = [int]($rect.X + $rect.Width / 2)
            $y = [int]($rect.Y + $rect.Height / 2)
            [ClickHelper]::Click($x, $y)
            Write-Output "Clicked at ($x, $y)"
            Start-Sleep -Seconds 6
            break
        }
    } catch {}
}

# Read page after click
Write-Output "=== AFTER NETWORKS CLICK ==="
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$count = 0
foreach ($el in $allElements2) {
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
