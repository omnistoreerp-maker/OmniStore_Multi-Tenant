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

# Verify form state via JS
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = @'
javascript:void((function(){
  var typeSelect = document.querySelector('select[name="type"]');
  var domainSelect = document.querySelector('select[name="domain_id"]');
  var subdomainInput = document.querySelector('input[name="subdomain"]');
  var addressInput = document.querySelector('input[name="address"]');
  var captchaImg = document.querySelector('#captcha');
  var captchaInput = document.querySelector('#captcha_code');
  var result = {
    type: typeSelect ? typeSelect.value : 'NOT FOUND',
    domain: domainSelect ? domainSelect.options[domainSelect.selectedIndex].text : 'NOT FOUND',
    domainId: domainSelect ? domainSelect.value : 'NOT FOUND',
    subdomain: subdomainInput ? subdomainInput.value : 'NOT FOUND',
    address: addressInput ? addressInput.value : 'NOT FOUND',
    captchaVisible: captchaImg ? (captchaImg.naturalWidth > 0) : false,
    captchaInputFound: captchaInput ? true : false
  };
  document.title = 'FORM:' + JSON.stringify(result);
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

$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}
