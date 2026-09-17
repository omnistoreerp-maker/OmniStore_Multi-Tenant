Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32m {
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
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$euorgHandle = [IntPtr]::Zero
$callback = [Win32m+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32m]::IsWindowVisible($hWnd)) {
        $length = [Win32m]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32m]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32m]::ShowWindow($hWnd, 9) | Out-Null
                [Win32m]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32m]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# Scroll to absolute bottom
Write-Host "Scrolling to bottom..."
[System.Windows.Forms.SendKeys]::SendWait("^{END}")
Start-Sleep -Seconds 2

# Take screenshot
$rect = New-Object Win32m+RECT
[Win32m]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -gt 0 -and $height -gt 0) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    
    $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-bottom.png"
    $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Screenshot saved: $savePath (${width}x${height})"
    
    $graphics.Dispose()
    $bitmap.Dispose()
}

# Read ALL elements at bottom of page
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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*domain*request*" -or $name -like "*New domain*")) {
            Write-Host "`n=== ALL ELEMENTS (last 50) ==="
            $allElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            
            $elements = @()
            foreach ($el in $allElements) {
                try {
                    $elName = $el.Current.Name
                    $controlType = $el.Current.ControlType.ProgrammaticName
                    $automationId = $el.Current.AutomationId
                    $elements += "[$controlType] Name='$elName' AId='$automationId'"
                } catch {}
            }
            
            $elements | Select-Object -Last 50 | ForEach-Object { Write-Host $_ }
            
            Write-Host "`n=== IMAGE ELEMENTS ==="
            foreach ($el in $allElements) {
                try {
                    $controlType = $el.Current.ControlType.ProgrammaticName
                    if ($controlType -eq "ControlType.Image") {
                        Write-Host "IMAGE: $($el.Current.Name) AId=$($el.Current.AutomationId)"
                    }
                } catch {}
            }
            
            Write-Host "`n=== BUTTON ELEMENTS ==="
            foreach ($el in $allElements) {
                try {
                    $controlType = $el.Current.ControlType.ProgrammaticName
                    if ($controlType -eq "ControlType.Button") {
                        Write-Host "BUTTON: $($el.Current.Name)"
                    }
                } catch {}
            }
            
            break
        }
    } catch {}
}
