Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32n {
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
$callback = [Win32n+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32n]::IsWindowVisible($hWnd)) {
        $length = [Win32n]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32n]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32n]::ShowWindow($hWnd, 9) | Out-Null
                [Win32n]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32n]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# First scroll to top to capture full form
[System.Windows.Forms.SendKeys]::SendWait("^{HOME}")
Start-Sleep -Seconds 1

# Take screenshot of top part
$rect = New-Object Win32n+RECT
[Win32n]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -gt 0 -and $height -gt 0) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    
    $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-top.png"
    $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Top screenshot saved: $savePath"
    
    $graphics.Dispose()
    $bitmap.Dispose()
}

# Now scroll to middle
[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
Start-Sleep -Milliseconds 500

# Take screenshot of middle
$rect2 = New-Object Win32n+RECT
[Win32n]::GetWindowRect($script:euorgHandle, [ref]$rect2) | Out-Null

$bitmap2 = New-Object System.Drawing.Bitmap($width, $height)
$graphics2 = [System.Drawing.Graphics]::FromImage($bitmap2)
$graphics2.CopyFromScreen($rect2.Left, $rect2.Top, 0, 0, [System.Drawing.Size]::new($width, $height))

$savePath2 = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-mid.png"
$bitmap2.Save($savePath2, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Mid screenshot saved: $savePath2"

$graphics2.Dispose()
$bitmap2.Dispose()

# Scroll to bottom
[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
Start-Sleep -Milliseconds 500

# Take screenshot of bottom
$rect3 = New-Object Win32n+RECT
[Win32n]::GetWindowRect($script:euorgHandle, [ref]$rect3) | Out-Null

$bitmap3 = New-Object System.Drawing.Bitmap($width, $height)
$graphics3 = [System.Drawing.Graphics]::FromImage($bitmap3)
$graphics3.CopyFromScreen($rect3.Left, $rect3.Top, 0, 0, [System.Drawing.Size]::new($width, $height))

$savePath3 = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-submit.png"
$bitmap3.Save($savePath3, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "Submit area screenshot saved: $savePath3"

$graphics3.Dispose()
$bitmap3.Dispose()

Write-Host "`nAll screenshots saved. Check the .freebuff folder."
