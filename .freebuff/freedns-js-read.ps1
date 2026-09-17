# Use JavaScript via clipboard to read FreeDNS form dropdown options
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

# First, use Ctrl+Shift+J to open console, then type JS to read form
# Actually, let's use a simpler approach - read DOM via accessibility

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

# Set focus to Chrome and use Ctrl+L to focus address bar
$chrome.SetFocus()
Start-Sleep -Milliseconds 500

# Type javascript URL to read form select options
[System.Windows.Forms.SendKeys]::SendWait("^l")
Start-Sleep -Milliseconds 300

# We need to type in the address bar
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = "javascript:void(document.title=Array.from(document.querySelectorAll('select')).map(s=>s.name+'='+Array.from(s.options).map(o=>o.text+'|'+o.value).join(',')).join(';;'))"
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Executed JS to read form selects"
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

# Read the page title which should now contain the form data
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            $chrome = $w
            $title = $chrome.Current.Name
            Write-Host "Page title: $title"
            break
        }
    } catch {}
}
