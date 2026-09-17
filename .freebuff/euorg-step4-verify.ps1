Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32o {
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

$euorgHandle = [IntPtr]::Zero
$callback = [Win32o+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32o]::IsWindowVisible($hWnd)) {
        $length = [Win32o]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32o]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*request*" -or $title -like "*New domain*") {
                [Win32o]::ShowWindow($hWnd, 9) | Out-Null
                [Win32o]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32o]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

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
            Write-Host "=== FORM FIELD VERIFICATION ==="
            Write-Host "Page: $name"
            Write-Host ""
            
            $editElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
            )
            
            $fieldMap = @{
                "" = "Domain name (first empty field)"
                "id_pn1" = "Organization Name"
                "id_ad1" = "Address Line 1"
                "id_ad2" = "Address Line 2"
                "id_ad3" = "Address Line 3"
                "id_ad4" = "Address Line 4"
                "id_ad5" = "Address Line 5"
                "id_ph1" = "Phone"
                "id_fx1" = "Fax"
                "id_f1" = "Name Server 1"
                "id_f2" = "Name Server 2"
                "id_f3" = "Name Server 3"
                "id_i1" = "IP1"
                "id_i2" = "IP2"
            }
            
            $expectedValues = @{
                "" = "omnistore.eu.org"
                "id_pn1" = "omni store"
                "id_ad1" = "Giza mol elbostan"
                "id_ph1" = "01020841414"
                "id_f1" = "corey.ns.cloudflare.com"
                "id_f2" = "desiree.ns.cloudflare.com"
            }
            
            $allCorrect = $true
            foreach ($edit in $editElements) {
                try {
                    $automationId = $edit.Current.AutomationId
                    $elName = $edit.Current.Name
                    $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $vp.Current.Value
                    
                    $fieldName = if ($fieldMap.ContainsKey($automationId)) { $fieldMap[$automationId] } else { $elName }
                    $expected = $expectedValues[$automationId]
                    
                    if ($expected) {
                        $status = if ($value -eq $expected) { "OK" } else { "MISMATCH" }
                        if ($status -eq "MISMATCH") { $allCorrect = $false }
                        Write-Host "[$status] $fieldName = '$value' (expected: '$expected')"
                    } elseif ($automationId -eq "" -and $value -ne "") {
                        # Check if this is the domain name field
                        if ($value -eq "omnistore.eu.org") {
                            Write-Host "[OK] Domain name = '$value'"
                        } elseif ($value -eq "OS773-FREE") {
                            Write-Host "[OK] Technical contact = '$value'"
                        }
                    }
                } catch {}
            }
            
            # Check combo boxes
            Write-Host ""
            Write-Host "=== CHECKBOX STATUS ==="
            $checkboxElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::CheckBox
                )
            )
            
            foreach ($cb in $checkboxElements) {
                try {
                    $name = $cb.Current.Name
                    $togglePattern = $cb.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
                    $state = $togglePattern.Current.ToggleState
                    Write-Host "Checkbox '$name': $state"
                } catch {}
            }
            
            Write-Host ""
            if ($allCorrect) {
                Write-Host "=== ALL EXPECTED FIELDS CORRECT ==="
            } else {
                Write-Host "=== SOME FIELDS NEED CORRECTION ==="
            }
            
            break
        }
    } catch {}
}
