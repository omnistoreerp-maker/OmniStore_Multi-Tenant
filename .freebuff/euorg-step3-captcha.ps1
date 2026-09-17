Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32k {
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

# Find EU.org window
$euorgHandle = [IntPtr]::Zero
$callback = [Win32k+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32k]::IsWindowVisible($hWnd)) {
        $length = [Win32k]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32k]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32k]::ShowWindow($hWnd, 9) | Out-Null
                [Win32k]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32k]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

# Scroll down to see CAPTCHA
Write-Host "Scrolling down to find CAPTCHA..."
[System.Windows.Forms.SendKeys]::SendWait("{END}")
Start-Sleep -Seconds 1
[System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
Start-Sleep -Seconds 1

# Take screenshot
$rect = New-Object Win32k+RECT
[Win32k]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -gt 0 -and $height -gt 0) {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
    
    $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-form-filled.png"
    $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Screenshot saved: $savePath"
    
    $graphics.Dispose()
    $bitmap.Dispose()
}

# Read page content after scroll
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
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -like "*domain*request*") {
            Write-Host "`n=== PAGE CONTENT AFTER SCROLL ==="
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
            
            # Check for images (CAPTCHA)
            Write-Host "`n=== IMAGES (CAPTCHA) ==="
            $imageElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Image
                )
            )
            
            foreach ($img in $imageElements) {
                try {
                    Write-Host "Image: $($img.Current.Name)"
                } catch {}
            }
            
            # Check for buttons (Save/Submit)
            Write-Host "`n=== BUTTONS ==="
            $buttonElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Button
                )
            )
            
            foreach ($btn in $buttonElements) {
                try {
                    $btnName = $btn.Current.Name
                    if ($btnName -like "*Save*" -or $btnName -like "*Submit*" -or $btnName -like "*Request*" -or $btnName -like "*Create*") {
                        Write-Host "Button: $btnName"
                    }
                } catch {}
            }
            
            break
        }
    } catch {}
}
