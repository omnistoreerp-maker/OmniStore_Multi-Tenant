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

# Check URL
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                Write-Host "URL: $($vp.Current.Value)"
            }
            break
        }
    } catch {}
}

# Navigate back to form
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $vp.SetValue("https://freedns.afraid.org/subdomain/edit.php")
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating to form..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Now fill the form and verify
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
  if (typeSelect) typeSelect.value = 'CNAME';
  if (domainSelect) domainSelect.value = '2';
  if (subdomainInput) subdomainInput.value = 'cairotech';
  if (addressInput) addressInput.value = '7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com';
  var captchaImg = document.querySelector('#captcha');
  document.title = JSON.stringify({
    type: typeSelect ? typeSelect.value : 'NONE',
    domain: domainSelect ? domainSelect.options[domainSelect.selectedIndex].text : 'NONE',
    subdomain: subdomainInput ? subdomainInput.value : 'NONE',
    address: addressInput ? addressInput.value : 'NONE',
    captcha: captchaImg ? captchaImg.src : 'NONE'
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

$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host "FORM STATE: $($w.Current.Name)"
            break
        }
    } catch {}
}
