Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32e {
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

Write-Host "=== ALL VISIBLE WINDOWS ==="
$listCallback = [Win32e+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32e]::IsWindowVisible($hWnd)) {
        $length = [Win32e]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32e]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title.Length -gt 3 -and ($title -like "*eu.org*" -or $title -like "*EU*" -or $title -like "*OS773*" -or $title -like "*OS774*" -or $title -like "*Domain*" -or $title -like "*Chrome*" -or $title -like "*Contact*")) {
                Write-Host "  Window: $title (handle: $hWnd)"
            }
        }
    }
    return $true
}
[Win32e]::EnumWindows($listCallback, [IntPtr]::Zero) | Out-Null

# Also find EU.org window and read its URL
Write-Host "`n=== EU.ORG WINDOW URL ==="
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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*OS773*" -or $name -like "*Domain List*" -or $name -like "*Contact*")) {
            Write-Host "Chrome: $name"
            
            # Find URL bar
            $urlBar = $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                    "10018"
                )
            )
            
            if ($urlBar) {
                $vp = $urlBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) {
                    Write-Host "  URL: $($vp.Current.Value)"
                }
            }
        }
    } catch {}
}

# Now navigate to New Domain page to check if there are any pending requests
Write-Host "`n=== CHECKING NEW DOMAIN PAGE FOR PENDING REQUESTS ==="
$euorgHandle = [IntPtr]::Zero
$callback = [Win32e+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32e]::IsWindowVisible($hWnd)) {
        $length = [Win32e]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32e]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*Domain List*OS773*" -or $title -like "*Contact Change*") {
                [Win32e]::ShowWindow($hWnd, 9) | Out-Null
                [Win32e]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32e]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

if ($script:euorgHandle -ne [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 500
    
    foreach ($w in $chromeWindows) {
        try {
            $class = $w.Current.ClassName
            $name = $w.Current.Name
            if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*OS773*" -or $name -like "*Domain List*" -or $name -like "*Contact*")) {
                # Navigate to New Domain page
                $urlBar = $w.FindFirst(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
                        "10018"
                    )
                )
                
                if ($urlBar) {
                    try { $urlBar.SetFocus() } catch {}
                    Start-Sleep -Milliseconds 300
                    [System.Windows.Forms.SendKeys]::SendWait("^l")
                    Start-Sleep -Milliseconds 300
                    
                    $vp = $urlBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    if ($vp) {
                        $vp.SetValue("https://nic.eu.org/arf/en/domain/new/")
                        Start-Sleep -Milliseconds 200
                        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                        Write-Host "Navigating to New Domain page..."
                        Start-Sleep -Seconds 4
                        
                        # Read the page content
                        Write-Host "`n=== NEW DOMAIN PAGE CONTENT ==="
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
                        
                        # Go back to Domains page
                        $vp.SetValue("https://nic.eu.org/arf/en/")
                        Start-Sleep -Milliseconds 200
                        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                        Start-Sleep -Seconds 3
                    }
                }
                break
            }
        } catch {}
    }
}
