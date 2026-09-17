Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32v {
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
$callback = [Win32v+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32v]::IsWindowVisible($hWnd)) {
        $length = [Win32v]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32v]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*eu.org*" -or $title -like "*OS773*" -or $title -like "*domain*") {
                [Win32v]::ShowWindow($hWnd, 9) | Out-Null
                [Win32v]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32v]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# Use Ctrl+L to focus address bar, then type URL
Write-Host "Focusing address bar..."
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500

# Select all and type URL
[System.Windows.Forms.SendKeys]::SendWait("^a")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("https://nic.eu.org/arf/en/")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Host "Navigating..."
Start-Sleep -Seconds 5

# Now read the page
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

$chromeWindows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
)

foreach ($w in $chromeWindows) {
    try {
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1') {
            $name = $w.Current.Name
            Write-Host "`nChrome: $name"
            
            if ($name -like "*Domain List*" -or $name -like "*OS773*") {
                Write-Host "=== DOMAINS PAGE LOADED ==="
                
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
                
                # Take screenshot
                $rect = New-Object Win32v+RECT
                [Win32v]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
                $width = $rect.Right - $rect.Left
                $height = $rect.Bottom - $rect.Top
                
                $bitmap = New-Object System.Drawing.Bitmap($width, $height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
                
                $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-domains-pending-final.png"
                $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
                Write-Host "`nScreenshot saved: $savePath"
                
                $graphics.Dispose()
                $bitmap.Dispose()
                break
            }
        }
    } catch {}
}
