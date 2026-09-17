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
  var domains = [
    {id:'14',name:'chickenkiller.com'},
    {id:'2',name:'strangled.net'},
    {id:'428',name:'ignorelist.com'},
    {id:'8681',name:'twilightparadox.com'},
    {id:'88098',name:'crabdance.com'},
    {id:'87966',name:'jumpingcrab.com'}
  ];
  var results = [];
  var done = 0;
  domains.forEach(function(d){
    var fd = new FormData();
    fd.append('type','CNAME');
    fd.append('subdomain','cairotech');
    fd.append('domain_id',d.id);
    fd.append('address','7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com');
    fd.append('captcha_code','test123');
    fetch('save.php?step=2',{method:'POST',body:fd}).then(function(r){return r.text()}).then(function(html){
      var text = html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
      var restricted = text.indexOf('restricted') >= 0;
      var cnameErr = text.indexOf('CNAME') >= 0 && text.indexOf('restricted') >= 0;
      var captchaErr = text.indexOf('Incorrect') >= 0 || text.indexOf('captcha') >= 0;
      var h2match = text.match(/Problems![\s\S]{0,200}/);
      var msg = h2match ? h2match[0].substring(0,200) : text.substring(0,200);
      results.push(d.name + ' => ' + (restricted ? 'RESTRICTED_CNAME' : 'OTHER: ' + msg));
      done++;
      if (done === domains.length) document.title = 'RESULTS:' + results.join(' ||| ');
    });
  });
})())
'@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Testing all domains..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 10

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
