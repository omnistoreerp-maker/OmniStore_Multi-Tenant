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

$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = @'
javascript:void((function(){
  // Find the Type select
  var selects = document.querySelectorAll('select');
  var typeSelect = null;
  selects.forEach(function(s){
    Array.from(s.options).forEach(function(o){
      if (o.text.indexOf('CNAME') >= 0) { typeSelect = s; }
    });
  });
  
  if (typeSelect) {
    // Find CNAME option value
    Array.from(typeSelect.options).forEach(function(o){
      if (o.text.indexOf('CNAME') >= 0) {
        typeSelect.value = o.value;
        typeSelect.dispatchEvent(new Event('change', {bubbles:true}));
      }
    });
  }
  
  // Read form state after change
  var inputs = [];
  document.querySelectorAll('input,select').forEach(function(el){
    if (el.name && el.name !== 'q' && el.name !== 'qq') {
      inputs.push({name:el.name,type:el.type,value:el.value});
    }
  });
  document.title = JSON.stringify(inputs);
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

$chromeWindows2 = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows2) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
