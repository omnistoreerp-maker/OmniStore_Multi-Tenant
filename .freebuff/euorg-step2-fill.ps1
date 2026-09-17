Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32j {
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
$callback = [Win32j+EnumWindowsProc]{
    param($hWnd, $lParam)
    if ([Win32j]::IsWindowVisible($hWnd)) {
        $length = [Win32j]::GetWindowTextLength($hWnd)
        if ($length -gt 0) {
            $sb = New-Object System.Text.StringBuilder($length + 1)
            [Win32j]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()
            if ($title -like "*domain*" -or $title -like "*Domain*") {
                [Win32j]::ShowWindow($hWnd, 9) | Out-Null
                [Win32j]::SetForegroundWindow($hWnd) | Out-Null
                Start-Sleep -Milliseconds 500
                $script:euorgHandle = $hWnd
                return $false
            }
        }
    }
    return $true
}
[Win32j]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

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
        if ($class -eq 'Chrome_WidgetWin_1' -and ($name -like "*domain*" -or $name -like "*Domain*")) {
            Write-Host "Found Chrome: $name"
            
            # Find ALL edit fields
            Write-Host "`n=== FINDING ALL EDIT FIELDS ==="
            $editElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.PropertyCondition]::new(
                    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                    [System.Windows.Automation.ControlType]::Edit
                )
            )
            
            $editIndex = 0
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    $automationId = $edit.Current.AutomationId
                    $value = ""
                    try {
                        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                        $value = $vp.Current.Value
                    } catch {}
                    Write-Host "Edit[$editIndex]: Name='$elName' AutomationId='$automationId' Value='$value'"
                    $editIndex++
                } catch {}
            }
            
            # STEP 1: Fill domain name field
            Write-Host "`n=== STEP 1: Fill domain name ==="
            $domainField = $null
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    $automationId = $edit.Current.AutomationId
                    # The domain name field is typically the first empty text field after "Complete domain name"
                    if ($elName -like "*domain*" -or $automationId -like "*domain*" -or $automationId -like "*name*") {
                        $domainField = $edit
                        break
                    }
                } catch {}
            }
            
            # If not found by name, try the first empty edit field that's not address/phone
            if (-not $domainField) {
                Write-Host "Domain field not found by name, trying first suitable field..."
                foreach ($edit in $editElements) {
                    try {
                        $elName = $edit.Current.Name
                        $automationId = $edit.Current.AutomationId
                        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                        $value = $vp.Current.Value
                        if ($value -eq "" -and $elName -notlike "*Address*" -and $elName -notlike "*Phone*" -and 
                            $elName -notlike "*Fax*" -and $elName -notlike "*IP*" -and $elName -notlike "*Name*" -and
                            $elName -notlike "*search*") {
                            $domainField = $edit
                            break
                        }
                    } catch {}
                }
            }
            
            if ($domainField) {
                try {
                    $vp = $domainField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $vp.SetValue("omnistore.eu.org")
                    Write-Host "Domain name set to: omnistore.eu.org"
                } catch {
                    Write-Host "Failed to set domain: $_"
                    # Try keyboard input
                    $domainField.SetFocus()
                    Start-Sleep -Milliseconds 200
                    [System.Windows.Forms.SendKeys]::SendWait("omnistore.eu.org")
                    Write-Host "Domain name typed via keyboard"
                }
            } else {
                Write-Host "ERROR: Could not find domain name field"
            }
            
            # STEP 2: Check organization fields
            Write-Host "`n=== STEP 2: Check organization fields ==="
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $vp.Current.Value
                    if ($elName -like "*Name*" -and $value -ne "") {
                        Write-Host "Org Name: $value"
                    }
                    if ($elName -like "*Address*" -and $value -ne "") {
                        Write-Host "Org Address: $value"
                    }
                    if ($elName -like "*Phone*" -and $value -ne "") {
                        Write-Host "Org Phone: $value"
                    }
                } catch {}
            }
            
            # STEP 3: Set technical contact
            Write-Host "`n=== STEP 3: Set technical contact ==="
            # Find the technical contact field
            $techField = $null
            $foundTechLabel = $false
            $allElements = $w.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            )
            
            foreach ($el in $allElements) {
                try {
                    $elName = $el.Current.Name
                    if ($elName -like "*Technical contact*") {
                        $foundTechLabel = $true
                        Write-Host "Found Technical contact label"
                    }
                } catch {}
            }
            
            # Find the edit field after "Technical contact" section
            # It should be near the end of the form, before nameservers
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    $automationId = $edit.Current.AutomationId
                    $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $vp.Current.Value
                    # The technical contact field might have the handle as value or be empty
                    if ($elName -like "*Technical*" -or ($automationId -like "*tech*")) {
                        $techField = $edit
                        break
                    }
                } catch {}
            }
            
            # If not found by name, look for edit fields with "OS773-FREE" value
            if (-not $techField) {
                foreach ($edit in $editElements) {
                    try {
                        $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                        $value = $vp.Current.Value
                        if ($value -eq "OS773-FREE") {
                            $techField = $edit
                            Write-Host "Found tech contact field with OS773-FREE value"
                            break
                        }
                    } catch {}
                }
            }
            
            if ($techField) {
                try {
                    $vp = $techField.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $currentValue = $vp.Current.Value
                    Write-Host "Technical contact current value: $currentValue"
                    if ($currentValue -ne "OS773-FREE") {
                        $vp.SetValue("OS773-FREE")
                        Write-Host "Technical contact set to: OS773-FREE"
                    } else {
                        Write-Host "Technical contact already set to: OS773-FREE"
                    }
                } catch {
                    Write-Host "Failed to set tech contact: $_"
                }
            } else {
                Write-Host "Technical contact field not found - may already be auto-set"
            }
            
            # STEP 4: Fill nameservers
            Write-Host "`n=== STEP 4: Fill nameservers ==="
            $ns1Field = $null
            $ns2Field = $null
            
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    if ($elName -eq "Name1") { $ns1Field = $edit }
                    if ($elName -eq "Name2") { $ns2Field = $edit }
                } catch {}
            }
            
            if ($ns1Field) {
                try {
                    $vp = $ns1Field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $vp.SetValue("corey.ns.cloudflare.com")
                    Write-Host "NS1 set to: corey.ns.cloudflare.com"
                } catch {
                    Write-Host "Failed to set NS1: $_"
                }
            } else {
                Write-Host "NS1 field not found"
            }
            
            if ($ns2Field) {
                try {
                    $vp = $ns2Field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $vp.SetValue("desiree.ns.cloudflare.com")
                    Write-Host "NS2 set to: desiree.ns.cloudflare.com"
                } catch {
                    Write-Host "Failed to set NS2: $_"
                }
            } else {
                Write-Host "NS2 field not found"
            }
            
            # STEP 5: Read final form state
            Write-Host "`n=== FINAL FORM STATE ==="
            foreach ($edit in $editElements) {
                try {
                    $elName = $edit.Current.Name
                    $vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                    $value = $vp.Current.Value
                    if ($value -ne "" -or $elName -like "*Name*" -or $elName -like "*IP*") {
                        Write-Host "Field '$elName' = '$value'"
                    }
                } catch {}
            }
            
            break
        }
    } catch {}
}
