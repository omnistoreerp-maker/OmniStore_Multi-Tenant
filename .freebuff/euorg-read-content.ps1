Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32b {
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

# Find EU.org window
$euorgHandle = [IntPtr]::Zero

$callback = [Win32b+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32b]::IsWindowVisible($hWnd)) {
        $length = [Win32b]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32b]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*OS773*" -or $title -like "*eu.org*" -or $title -like "*Domain List*") {
                Write-Host "FOUND: $title (handle: $hWnd)"
                [Win32b]::ShowWindow($hWnd, 9) | Out-Null
                [Win32b]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 800
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}

[Win32b]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Write-Host "EU.org window activated. Reading content..."

Start-Sleep -Seconds 1

# Read via UI Automation
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

# Find the EU.org Chrome window by iterating all Chrome windows
$chromeWindows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
)

$euorgChrome = $null
foreach ($w in $chromeWindows) {
    try {
        $class = $w.Current.ClassName
        $name = $w.Current.Name
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*OS773*" -or $name -like "*Domain*" -or $name -like "*eu.org*")) {
            $euorgChrome = $w
            Write-Host "Found EU.org Chrome: $name"
            break
        }
    } catch {}
}

if (-not $euorgChrome) {
    Write-Host "EU.org Chrome element not found, trying all Chrome windows..."
    foreach ($w in $chromeWindows) {
        try {
            $class = $w.Current.ClassName
            if ($class -eq 'Chrome_WidgetWin_1') {
                $name = $w.Current.Name
                Write-Host "  Chrome: $name"
                if ($name -ne 'Freebuff Desktop' -and $name.Length -gt 5) {
                    $euorgChrome = $w
                }
            }
        } catch {}
    }
}

if (-not $euorgChrome) {
    Write-Host "No suitable Chrome window found"
    exit 1
}

# Read all text content
Write-Host "`n=== FULL PAGE TEXT ==="
$allElements = $euorgChrome.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.Condition]::TrueCondition
)

$textItems = @()
foreach ($el in $allElements) {
    try {
        $elName = $el.Current.Name
        $controlType = $el.Current.ControlType.ProgrammaticName
        if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 500) {
            $textItems += "[$controlType] $elName"
        }
    } catch {}
}

$textItems | ForEach-Object { Write-Host $_ }
