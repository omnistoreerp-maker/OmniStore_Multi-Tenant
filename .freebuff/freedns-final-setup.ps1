Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

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

# Navigate to FreeDNS add subdomain form
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $vp.SetValue("https://freedns.afraid.org/subdomain/edit.php")
                Start-Sleep -Milliseconds 300
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Navigating to FreeDNS form..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Fill form via JavaScript
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $js = @'
javascript:void((function(){
  var typeSelect = document.querySelector('select[name="type"]');
  if (typeSelect) typeSelect.value = 'CNAME';
  
  var domainSelect = document.querySelector('select[name="domain_id"]');
  if (domainSelect) domainSelect.value = '2';
  
  var subdomainInput = document.querySelector('input[name="subdomain"]');
  if (subdomainInput) subdomainInput.value = 'cairotech';
  
  var addressInput = document.querySelector('input[name="address"]');
  if (addressInput) addressInput.value = '7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com';
  
  document.title = 'Form filled: CNAME cairotech.strangled.net -> tunnel';
})())
'@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Filling form..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

# Read title to confirm
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host "Status: $($w.Current.Name)"
            break
        }
    } catch {}
}

Start-Sleep -Seconds 1

# Take screenshot of the filled form
$bounds = $chrome.Current.BoundingRectangle
$screenshot = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($screenshot)
$graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $screenshot.Size)
$screenshot.Save("E:\Projects\OmniStore_Multi-Tenant\.freebuff\freedns-captcha-ready.png")
$graphics.Dispose()
$screenshot.Dispose()
Write-Host "Screenshot saved"
