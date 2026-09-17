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

# Fill form via JS
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = @'
javascript:void((function(){
  // Set Host to cairotech
  var host = document.getElementById('Host');
  if (host) { host.value = 'cairotech'; host.dispatchEvent(new Event('input')); }
  
  // Set Container to giize.com
  var container = document.getElementById('Container');
  if (container) { container.value = 'giize.com'; container.dispatchEvent(new Event('change')); }
  
  // Read form state
  document.title = JSON.stringify({
    host: host ? host.value : 'N/A',
    container: container ? container.value : 'N/A',
    domainName: document.getElementById('DomainName') ? document.getElementById('DomainName').value : 'N/A'
  });
})())
'@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

# Read result
$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
