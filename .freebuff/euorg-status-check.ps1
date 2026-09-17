Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32x {
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
$callback = [Win32x+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32x]::IsWindowVisible($hWnd)) {
        $length = [Win32x]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32x]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*eu.org*" -or $title -like "*OS773*" -or $title -like "*Domain*") {
                [Win32x]::ShowWindow($hWnd, 9) | Out-Null
                [Win32x]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32x]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found, opening..."
    start "https://nic.eu.org/arf/en/"
    Start-Sleep -Seconds 6
    [Win32x]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
}

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window still not found"
    exit 1
}

Start-Sleep -Milliseconds 500
Write-Host "EU.org window activated"

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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*eu.org*" -or $name -like "*OS773*" -or $name -like "*Domain*")) {
            Write-Host "Page: $name"
            Write-Host ""
            Write-Host "=== PAGE CONTENT ==="
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

            # Check DataItems
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
                try {
                    Write-Host "  $($item.Current.Name)"
                } catch {}
            }

            # Get URL
            Write-Host ""
            Write-Host "=== URL ==="
            $urlBar = $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                    "10018"
                )
            )
            if ($urlBar) {
                $vp = $urlBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) { Write-Host "URL: $($vp.Current.Value)" }
            }
            break
        }
    } catch {}
}
