Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32c {
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
$callback = [Win32c+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32c]::IsWindowVisible($hWnd)) {
        $length = [Win32c]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32c]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*OS773*" -or $title -like "*Domain List*") {
                [Win32c]::ShowWindow($hWnd, 9) | Out-Null
                [Win32c]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32c]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

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

$euorgChrome = $null
foreach ($w in $chromeWindows) {
    try {
        $class = $w.Current.ClassName
        $name = $w.Current.Name
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*OS773*" -or $name -like "*Domain List*")) {
            $euorgChrome = $w
            break
        }
    } catch {}
}

if (-not $euorgChrome) {
    Write-Host "EU.org Chrome not found"
    exit 1
}

Write-Host "=== TASK 1: Click Information link ==="

# Find and click Information link
$infoLink = $euorgChrome.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "Information"
    )
)

if ($infoLink) {
    Write-Host "Found Information link, clicking..."
    $invokePattern = $infoLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($invokePattern) {
        $invokePattern.Invoke()
    } else {
        # Try click
        $falsePattern = $infoLink.GetCurrentPattern([System.Windows.Automation.AutomationElement]::Pattern)
        $infoLink.SetFocus()
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    Start-Sleep -Seconds 3
    
    # Read Information page content
    Write-Host "`n=== INFORMATION PAGE CONTENT ==="
    $allElements = $euorgChrome.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    
    foreach ($el in $allElements) {
        try {
            $elName = $el.Current.Name
            $controlType = $el.Current.ControlType.ProgrammaticName
            if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 500 -and 
                $controlType -notlike "*Button*" -and $controlType -notlike "*Pane*" -and
                $controlType -notlike "*Separator*" -and $controlType -notlike "*ToolBar*") {
                Write-Host "[$controlType] $elName"
            }
        } catch {}
    }
    
    # Also read edit fields (text inputs)
    Write-Host "`n=== EDIT FIELDS ==="
    $editElements = $euorgChrome.FindAll(
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
} else {
    Write-Host "Information link not found"
}

# Go back to Domains page
Write-Host "`n=== TASK 2: Go back to Domains ==="
$domainsLink = $euorgChrome.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "Domains"
    )
)

if ($domainsLink) {
    $invokePattern = $domainsLink.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($invokePattern) {
        $invokePattern.Invoke()
    } else {
        $domainsLink.SetFocus()
        Start-Sleep -Milliseconds 200
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    Start-Sleep -Seconds 3
    
    Write-Host "`n=== DOMAINS PAGE CONTENT ==="
    $allElements = $euorgChrome.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    
    foreach ($el in $allElements) {
        try {
            $elName = $el.Current.Name
            $controlType = $el.Current.ControlType.ProgrammaticName
            if ($elName -and $elName.Length -gt 1 -and $elName.Length -lt 500 -and 
                $controlType -notlike "*Button*" -and $controlType -notlike "*Pane*" -and
                $controlType -notlike "*Separator*" -and $controlType -notlike "*ToolBar*") {
                Write-Host "[$controlType] $elName"
            }
        } catch {}
    }
    
    # Check for DataItem elements (table rows)
    Write-Host "`n=== TABLE DATA ITEMS ==="
    $dataItems = $euorgChrome.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::DataItem
        )
    )
    
    Write-Host "Total DataItems: $($dataItems.Count)"
    foreach ($item in $dataItems) {
        try {
            Write-Host "DataItem: $($item.Current.Name)"
        } catch {}
    }
} else {
    Write-Host "Domains link not found"
}
