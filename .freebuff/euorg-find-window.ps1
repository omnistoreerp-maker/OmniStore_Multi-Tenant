Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

# Use Windows Forms to find and activate Chrome
$procs = Get-Process chrome -ErrorAction SilentlyContinue
if (-not $procs) {
    Write-Host "Chrome not running"
    exit 1
}

Write-Host "Chrome processes: $($procs.Count)"

# Try to bring Chrome to foreground using Win32 API
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
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

# Find Chrome window with EU.org
$found = $false
$callback = [Win32+EnumWindowsProc]{
    param($hWnd, $lParam)
    $length = [Win32]::GetWindowTextLength($hWnd)
    if ($length -gt 0) {
        $sb = New-Object System.Text.StringBuilder($length + 1)
        [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        $title = $sb.ToString()
        if ($title -like "*eu.org*" -or $title -like "*EU.org*" -or $title -like "*nic.eu.org*") {
            Write-Host "Found EU.org window: $title (handle: $hWnd)"
            [Win32]::ShowWindow($hWnd, 9) | Out-Null  # SW_RESTORE
            [Win32]::SetForegroundWindow($hWnd) | Out-Null
            Start-Sleep -Milliseconds 500
            $script:found = $true
            return $false
        }
    }
    return $true
}

[Win32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if (-not $script:found) {
    Write-Host "No EU.org window found. Listing all visible windows:"
    $listCallback = [Win32+EnumWindowsProc]{
        param($hWnd, $lParam)
        if ([Win32]::IsWindowVisible($hWnd)) {
            $length = [Win32]::GetWindowTextLength($hWnd)
            if ($length -gt 0) {
                $sb = New-Object System.Text.StringBuilder($length + 1)
                [Win32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                $title = $sb.ToString()
                if ($title.Length -gt 3) {
                    Write-Host "  Window: $title"
                }
            }
        }
        return $true
    }
    [Win32]::EnumWindows($listCallback, [IntPtr]::Zero) | Out-Null
}

# Now try to read Chrome content via UI Automation
Start-Sleep -Seconds 1

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
        if ($class -eq 'Chrome_WidgetWin_1') {
            Write-Host "`nChrome window: $name"
            
            # Try to read all text
            $allElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            
            $textItems = @()
            foreach ($el in $allElements) {
                try {
                    $elName = $el.Current.Name
                    if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 300) {
                        $textItems += $elName
                    }
                } catch {}
            }
            
            Write-Host "Text elements: $($textItems.Count)"
            $textItems | Select-Object -First 80 | ForEach-Object { Write-Host "  $_" }
            break
        }
    } catch {}
}
