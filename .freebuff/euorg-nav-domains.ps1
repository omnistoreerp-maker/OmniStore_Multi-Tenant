Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32y {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@

$euorgHandle = [IntPtr]::Zero
$callback = [Win32y+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32y]::IsWindowVisible($hWnd)) {
        $length = [Win32y]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32y]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*eu.org*" -or $title -like "*domain*") {
                [Win32y]::ShowWindow($hWnd, 9) | Out-Null
                [Win32y]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32y]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# Use Ctrl+L to navigate
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("https://nic.eu.org/arf/en/")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Host "Navigating to Domains page..."
Start-Sleep -Seconds 5

# Read page content
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

$chromeWindows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
)

foreach ($w in $chromeWindows) {
    try {
        $class = $w.Current.ClassName
        $name = $w.Current.Name
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*Domain*" -or $name -like "*OS773*")) {
            Write-Host "Page: $name"
            Write-Host ""
            $allElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            foreach ($el in $allElements) {
                try {
                    $elName = $el.Current.Name
                    $controlType = $el.Current.ControlType.ProgrammaticName
                    if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 500 -and
                        $controlType -notlike "*Button*" -and $controlType -notlike "*Pane*" -and
                        $controlType -notlike "*Separator*" -and $controlType -notlike "*ToolBar*" -and
                        $controlType -notlike "*TabItem*") {
                        Write-Host "[$controlType] $elName"
                    }
                } catch {}
            }

            Write-Host ""
            Write-Host "=== TABLE DATA ITEMS ==="
            $dataItems = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::DataItem
                )
            )
            Write-Host "Total DataItems: $($dataItems.Count)"
            foreach ($item in $dataItems) {
                try { Write-Host "  $($item.Current.Name)" } catch {}
            }
            break
        }
    } catch {}
}
