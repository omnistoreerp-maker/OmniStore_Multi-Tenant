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
  var tests = [
    {id:'14',name:'chickenkiller'},
    {id:'2',name:'strangled'}
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
      var lower = text.toLowerCase();
      var idx = lower.indexOf('cname');
      var idx2 = lower.indexOf('restricted');
      var idx3 = lower.indexOf('captcha');
      var idx4 = lower.indexOf('incorrect');
      var idx5 = lower.indexOf('error');
      var idx6 = lower.indexOf('problems');
      var snippet = '';
      if (idx >= 0) snippet += 'CNAME_AT:' + text.substring(idx-50,idx+100) + ' ';
      if (idx2 >= 0) snippet += 'RESTRICTED_AT:' + text.substring(idx2-50,idx2+100) + ' ';
      if (idx3 >= 0) snippet += 'CAPTCHA_AT:' + text.substring(idx3-50,idx3+100) + ' ';
      if (idx4 >= 0) snippet += 'INCORRECT_AT:' + text.substring(idx4-50,idx4+100) + ' ';
      if (idx6 >= 0 && snippet === '') snippet += 'PROBLEMS_AT:' + text.substring(idx6,idx6+300) + ' ';
      if (snippet === '') snippet = 'LAST:' + text.substring(text.length - 500);
      results.push(d.name + ' => ' + snippet.substring(0,400));
      done++;
      if (done === tests.length) document.title = 'R:' + results.join(' ### ');
    });
  });
})())
'@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Testing..."
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
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
