Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32u {
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
$callback = [Win32u+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32u]::IsWindowVisible($hWnd)) {
        $length = [Win32u]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32u]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*eu.org*" -or $title -like "*OS773*" -or $title -like "*domain*") {
                [Win32u]::ShowWindow($hWnd, 9) | Out-Null
                [Win32u]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32u]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*eu.org*" -or $name -like "*OS773*" -or $name -like "*domain*")) {
            Write-Host "Found Chrome: $name"
            
            # Find all Hyperlinks
            Write-Host "`n=== ALL HYPERLINKS ==="
            $hyperlinks = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Hyperlink
                )
            )
            
            foreach ($link in $hyperlinks) {
                try {
                    Write-Host "Link: $($link.Current.Name)"
                } catch {}
            }
            
            # Find and click Domains link
            $domainsLink = $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    "Domains"
                )
            )
            
            if ($domainsLink) {
                Write-Host "`nClicking Domains link..."
                try {
                    # Try InvokePattern
                    $invokePattern = $domainsLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    if ($invokePattern) {
                        $invokePattern.Invoke()
                        Write-Host "Domains clicked via InvokePattern"
                    } else {
                        # Try LegacyIAccessiblePattern
                        $legacyPattern = $domainsLink.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
                        if ($legacyPattern) {
                            $legacyPattern.DoDefaultAction()
                            Write-Host "Domains clicked via LegacyIAccessiblePattern"
                        } else {
                            # Try Click
                            $domainsLink.SetFocus()
                            Start-Sleep -Milliseconds 200
                            $clickPattern = $domainsLink.GetCurrentPattern([System.Windows.Automation.TransformPattern]::Pattern)
                            if ($clickPattern) {
                                Write-Host "TransformPattern found"
                            }
                            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                            Write-Host "Domains clicked via Enter key"
                        }
                    }
                } catch {
                    Write-Host "Click error: $_"
                }
                
                Start-Sleep -Seconds 5
                
                # Read new page content
                Write-Host "`n=== NEW PAGE CONTENT ==="
                $newElements = $w.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    [System.Windows.Automation.Condition]::TrueCondition
                )
                
                foreach ($el in $newElements) {
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
                $rect = New-Object Win32u+RECT
                [Win32u]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
                $width = $rect.Right - $rect.Left
                $height = $rect.Bottom - $rect.Top
                
                $bitmap = New-Object System.Drawing.Bitmap($width, $height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
                
                $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-domains-after-click.png"
                $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
                Write-Host "`nScreenshot saved: $savePath"
                
                $graphics.Dispose()
                $bitmap.Dispose()
            } else {
                Write-Host "Domains link not found"
            }
            break
        }
    } catch {}
}
