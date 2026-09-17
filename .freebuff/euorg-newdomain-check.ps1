Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32f {
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

# Find EU.org window and bring to front
$euorgHandle = [IntPtr]::Zero
$callback = [Win32f+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32f]::IsWindowVisible($hWnd)) {
        $length = [Win32f]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32f]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*Domain List*OS773*") {
                [Win32f]::ShowWindow($hWnd, 9) | Out-Null
                [Win32f]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32f]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -eq [IntPtr]::Zero) {
    Write-Host "EU.org window not found"
    exit 1
}

Start-Sleep -Milliseconds 500
Write-Host "EU.org window activated"

# Use keyboard shortcut to navigate
# Ctrl+L to focus URL bar, then type URL
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500

# Type the URL
[System.Windows.Forms.SendKeys]::SendWait("https://nic.eu.org/arf/en/domain/new/")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Host "Navigating to New Domain page..."
Start-Sleep -Seconds 5

# Read the page content
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

# Find the active Chrome window
$chromeWindows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
)

foreach ($w in $chromeWindows) {
    try {
        $class = $w.Current.ClassName
        $name = $w.Current.Name
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop') {
            Write-Host "`n=== NEW DOMAIN PAGE ==="
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
            
            # Also check edit fields
            Write-Host "`n=== EDIT FIELDS ==="
            $editElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
            )
            
            foreach ($edit in $editElements) {
                try {
                    $name = $edit.Current.Name
                    $value = ""
                    try {
                        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                        $value = $vp.Current.Value
                    } catch {}
                    Write-Host "Edit: $name = $value"
                } catch {}
            }
            
            # Check combo boxes
            Write-Host "`n=== COMBO BOXES ==="
            $comboElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::ComboBox
                )
            )
            
            foreach ($combo in $comboElements) {
                try {
                    $name = $combo.Current.Name
                    Write-Host "ComboBox: $name"
                } catch {}
            }
            
            break
        }
    } catch {}
}

# Navigate back to Domains page
Write-Host "`n=== NAVIGATING BACK TO DOMAINS ==="
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("https://nic.eu.org/arf/en/")
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 3
Write-Host "Back to Domains page"
