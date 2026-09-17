Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32r {
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
$callback = [Win32r+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32r]::IsWindowVisible($hWnd)) {
        $length = [Win32r]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32r]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32r]::ShowWindow($hWnd, 9) | Out-Null
                [Win32r]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32r]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500

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
            Write-Host "Found EU.org form: $name"
            
            # Find Submit button
            $submitBtn = $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    "Submit"
                )
            )
            
            if ($submitBtn) {
                Write-Host "Found Submit button. Clicking..."
                try {
                    $invokePattern = $submitBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    if ($invokePattern) {
                        $invokePattern.Invoke()
                        Write-Host "Submit clicked via InvokePattern"
                    } else {
                        $submitBtn.SetFocus()
                        Start-Sleep -Milliseconds 200
                        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                        Write-Host "Submit clicked via Enter key"
                    }
                } catch {
                    Write-Host "Click failed: $_"
                }
                
                # Wait for page to load
                Start-Sleep -Seconds 5
                
                # Take screenshot of result
                $rect = New-Object Win32r+RECT
                [Win32r]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
                $width = $rect.Right - $rect.Left
                $height = $rect.Bottom - $rect.Top
                
                $bitmap = New-Object System.Drawing.Bitmap($width, $height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
                
                $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-after-submit.png"
                $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
                Write-Host "Screenshot saved: $savePath"
                
                $graphics.Dispose()
                $bitmap.Dispose()
                
                # Read page content after submit
                Write-Host "`n=== PAGE CONTENT AFTER SUBMIT ==="
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
                
                # Check for CAPTCHA elements
                Write-Host "`n=== CAPTCHA CHECK ==="
                foreach ($el in $allElements) {
                    try {
                        $elName = $el.Current.Name
                        $controlType = $el.Current.ControlType.ProgrammaticName
                        if ($elName -like "*captcha*" -or $elName -like "*CAPTCHA*" -or $elName -like "*security*" -or 
                            $elName -like "*code*" -or $elName -like "*image*" -or $elName -like "*verify*" -or
                            $controlType -eq "ControlType.Image") {
                            Write-Host "CAPTCHA: [$controlType] $elName"
                        }
                    } catch {}
                }
                
                # Check for error messages
                Write-Host "`n=== ERROR CHECK ==="
                foreach ($el in $allElements) {
                    try {
                        $elName = $el.Current.Name
                        if ($elName -like "*error*" -or $elName -like "*Error*" -or $elName -like "*problem*" -or
                            $elName -like "*fail*" -or $elName -like "*invalid*") {
                            Write-Host "ERROR: $elName"
                        }
                    } catch {}
                }
            } else {
                Write-Host "Submit button not found"
            }
            break
        }
    } catch {}
}
