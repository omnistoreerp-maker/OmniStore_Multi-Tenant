Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}
if (-not $chrome) { Write-Host "No Chrome"; exit 1 }

# Step 1: Fill Node Name (empty = root, or leave empty for cairotech.ooguy.com)
# Actually, the hostname field should be empty for the root, or contain the subdomain
# Since the zone is ooguy.com and the DDNS hostname is cairotech.ooguy.com,
# we need to add the CNAME for the root (empty node name)

# Step 2: Fill Hostname field with tunnel target
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        $type = $el.Current.ControlType.ProgrammaticName
        $name = $el.Current.Name
        if ($type -eq 'ControlType.Edit' -and $name -eq 'Hostname') {
            Write-Host "Found Hostname field"
            $el.SetFocus()
            Start-Sleep -Milliseconds 200
            [System.Windows.Forms.SendKeys]::SendWait("^a")
            Start-Sleep -Milliseconds 100
            [System.Windows.Forms.SendKeys]::SendWait("7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com")
            Start-Sleep -Milliseconds 300
            Write-Host "Typed tunnel hostname"
            break
        }
    } catch {}
}

# Step 3: Click Add DNS Record
Start-Sleep -Seconds 1
$allElements2 = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements2) {
    try {
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -eq 'ControlType.Button' -and $name -and $name -match 'Add DNS Record') {
            Write-Host "Found: $name"
            $invokePattern = $null
            try { $invokePattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) } catch {}
            if ($invokePattern) {
                $invokePattern.Invoke()
                Write-Host "Clicked Add DNS Record"
            } else {
                $el.SetFocus()
                Start-Sleep -Milliseconds 200
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Pressed Enter"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Read result
$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            break
        }
    } catch {}
}

foreach ($el in $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = 'javascript:void(document.title="PAGE:"+document.body.innerText.substring(0,3000))'
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

$chromeWindows3 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows3) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
