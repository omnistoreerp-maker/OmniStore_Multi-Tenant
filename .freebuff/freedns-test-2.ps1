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
                # Test just 2 domains with detailed response
                $js = @'
javascript:void((function(){
  var tests = [
    {id:'14',name:'chickenkiller.com'},
    {id:'2',name:'strangled.net'}
  ];
  var results = [];
  var done = 0;
  tests.forEach(function(d){
    var fd = new FormData();
    fd.append('type','CNAME');
    fd.append('subdomain','cairotech');
    fd.append('domain_id',d.id);
    fd.append('address','7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com');
    fd.append('captcha_code','invalid');
    fetch('save.php?step=2',{method:'POST',body:fd}).then(function(r){return r.text()}).then(function(html){
      var text = html.replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
      results.push(d.name + ' => ' + text.substring(0,300));
      done++;
      if (done === tests.length) document.title = 'R:' + results.join(' ||| ');
    });
  });
})())
'@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Testing 2 domains..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 8

$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host "RESULTS:"
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
