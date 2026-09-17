Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32t {
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
$callback = [Win32t+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32t]::IsWindowVisible($hWnd)) {
        $length = [Win32t]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32t]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*eu.org*" -or $title -like "*OS773*" -or $title -like "*domain*") {
                [Win32t]::ShowWindow($hWnd, 9) | Out-Null
                [Win32t]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32t]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500
Write-Host "Window activated"

# Navigate to Domains page using Ctrl+L
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500

# Type URL
[System.Windows.Forms.SendKeys]::SendWait("https://nic.eu.org/arf/en/")
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Host "Navigating to Domains page..."
Start-Sleep -Seconds 5

# Read page content
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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*Domain*" -or $name -like "*OS773*" -or $name -like "*eu.org*")) {
            Write-Host "`n=== DOMAINS PAGE ==="
            Write-Host "Window: $name"
            
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
            
            # Check DataItems
            Write-Host "`n=== TABLE ROWS ==="
            $dataItems = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::DataItem
                )
            )
            
            Write-Host "Total DataItems: $($dataItems.Count)"
            foreach ($item in $dataItems) {
                try {
                    Write-Host "  $($item.Current.Name)"
                } catch {}
            }
            
            # Take screenshot
            $rect = New-Object Win32t+RECT
            [Win32t]::GetWindowRect($script:euorgHandle, [ref]$rect) | Out-Null
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            
            $bitmap = New-Object System.Drawing.Bitmap($width, $height)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
            
            $savePath = "E:\Projects\OmniStore_Multi-Tenant\.freebuff\euorg-domains-final.png"
            $bitmap.Save($savePath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Host "`nScreenshot saved: $savePath"
            
            $graphics.Dispose()
            $bitmap.Dispose()
            break
        }
    } catch {}
}
