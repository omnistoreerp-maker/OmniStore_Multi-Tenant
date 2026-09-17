Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32p {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
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
$callback = [Win32p+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32p]::IsWindowVisible($hWnd)) {
        $length = [Win32p]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32p]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32p]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 300
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32p]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 300

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
            # Check for iframes
            Write-Host "=== IFRAME CHECK ==="
            $frameElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Pane
                )
            )
            
            $frameCount = 0
            foreach ($frame in $frameElements) {
                try {
                    $frameName = $frame.Current.Name
                    $frameAId = $frame.Current.AutomationId
                    if ($frameName -like "*iframe*" -or $frameName -like "*CAPTCHA*" -or $frameName -like "*recaptcha*" -or
                        $frameAId -like "*iframe*" -or $frameAId -like "*captcha*") {
                        Write-Host "Frame: Name='$frameName' AId='$frameAId'"
                        $frameCount++
                    }
                } catch {}
            }
            Write-Host "Total matching frames: $frameCount"
            
            # Check for all pane elements (might contain CAPTCHA)
            Write-Host "`n=== ALL PANE ELEMENTS ==="
            $paneCount = 0
            foreach ($pane in $frameElements) {
                try {
                    $paneName = $pane.Current.Name
                    $paneAId = $pane.Current.AutomationId
                    if ($paneName -or $paneAId) {
                        Write-Host "Pane: Name='$paneName' AId='$paneAId'"
                        $paneCount++
                    }
                } catch {}
            }
            Write-Host "Total named panes: $paneCount"
            
            # Check for document elements (might contain CAPTCHA)
            Write-Host "`n=== DOCUMENT ELEMENTS ==="
            $docElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Document
                )
            )
            
            foreach ($doc in $docElements) {
                try {
                    Write-Host "Document: $($doc.Current.Name)"
                } catch {}
            }
            
            # Total element count
            Write-Host "`n=== ELEMENT COUNT ==="
            $allElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            Write-Host "Total elements: $($allElements.Count)"
            
            break
        }
    } catch {}
}
