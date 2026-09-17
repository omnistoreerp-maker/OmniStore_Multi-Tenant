Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32q {
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
$callback = [Win32q+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32q]::IsWindowVisible($hWnd)) {
        $length = [Win32q]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32q]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32q]::ShowWindow($hWnd, 9) | Out-Null
                [Win32q]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32q]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# Scroll to top first
[System.Windows.Forms.SendKeys]::SendWait("^{HOME}")
Start-Sleep -Seconds 1

# Take full-page screenshot by scrolling through
$rect = New-Object Win32q+RECT
[Win32q]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

Write-Host "Window size: ${width}x${height}"

# Create a tall bitmap to capture the full page
$pageHeight = 2400  # approximate full page height
$fullBitmap = New-Object System.Drawing.Bitmap($width, $pageHeight)
$fullGraphics = [System.Drawing.Graphics]::FromImage($fullBitmap)

$yOffset = 0
$scrollCount = 0

while ($yOffset -lt $pageHeight) {
    # Take screenshot of current view
    $currentRect = New-Object Win32q+RECT
    [Win32q]::GetWindowRect($script:euorgHandle, [ref]$currentRect) | Out-Null
    $fullGraphics.CopyFromScreen($currentRect.Left, $currentRect.Top, 0, $yOffset, [System.Drawing.Size]::new($width, [Math]::Min($height, $pageHeight - $yOffset)))
    
    $yOffset += $height - 50  # overlap slightly
    $scrollCount++
    
    if ($scrollCount -gt 10) { break }
    
    # Scroll down
    [System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
    Start-Sleep -Milliseconds 500
}

# Save full page screenshot
$savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-full.png"
$fullBitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Full page screenshot saved: $savePath"

$fullGraphics.Dispose()
$fullBitmap.Dispose()

# Scroll back to top
[System.Windows.Forms.SendKeys]::SendWait("^{HOME}")
Start-Sleep -Milliseconds 500

# Final field verification
Write-Host "`n=== FINAL FIELD CHECK ==="
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
            $editElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
            )
            
            foreach ($edit in $editElements) {
                try {
                    $automationId = $edit.Current.AutomationId
                    $elName = $edit.Current.Name
                    $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $vp.Current.Value
                    if ($value -ne "") {
                        Write-Host "  $elName ($automationId) = $value"
                    }
                } catch {}
            }
            break
        }
    } catch {}
}
