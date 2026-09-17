Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32g {
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

# Find EU.org window
$euorgHandle = [IntPtr]::Zero
$callback = [Win32g+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32g]::IsWindowVisible($hWnd)) {
        $length = [Win32g]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32g]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*Domain List*OS773*") {
                [Win32g]::ShowWindow($hWnd, 9) | Out-Null
                [Win32g]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32g]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

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
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -like "*Domain List*OS773*") {
            Write-Host "Found EU.org Chrome: $name"
            
            # Find New Domain link
            $newDomainLink = $w.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::NameProperty,
                    "New Domain"
                )
            )
            
            if ($newDomainLink) {
                Write-Host "Found New Domain link, clicking..."
                try {
                    $invokePattern = $newDomainLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    if ($invokePattern) {
                        $invokePattern.Invoke()
                    } else {
                        $newDomainLink.SetFocus()
                        Start-Sleep -Milliseconds 200
                        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                    }
                } catch {
                    Write-Host "Click failed: $_"
                }
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
                
                # Check edit fields
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
                
                # Navigate back
                Write-Host "`n=== NAVIGATING BACK ==="
                $domainsLink = $w.FindFirst(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    [System.Windows.Automation.PropertyCondition]::new(
                        [System.Windows.Automation.AutomationElement]::NameProperty,
                        "Domains"
                    )
                )
                
                if ($domainsLink) {
                    try {
                        $invokePattern = $domainsLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                        if ($invokePattern) {
                            $invokePattern.Invoke()
                        }
                    } catch {}
                }
            } else {
                Write-Host "New Domain link not found"
            }
            break
        }
    } catch {}
}
