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
                Write-Host "Navigating..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 5

# Inject JS to fill the form
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ClassName -eq 'OmniboxViewViews') {
            $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            if ($vp) {
                $tunnelHost = "7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com"
                $js = @"
javascript:void((function(){
  // Set type to CNAME
  var typeSelect = document.querySelector('select[name="type"]');
  if (typeSelect) { typeSelect.value = 'CNAME'; typeSelect.dispatchEvent(new Event('change')); }
  
  // Set domain to strangled.net (value=2)
  var domainSelect = document.querySelector('select[name="domain_id"]');
  if (domainSelect) { domainSelect.value = '2'; domainSelect.dispatchEvent(new Event('change')); }
  
  // Set subdomain
  var inputs = document.querySelectorAll('input[type="text"]');
  inputs.forEach(function(inp) {
    if (inp.name === 'subdomain' || (inp.placeholder && inp.placeholder.indexOf('domain') >= 0)) {
      inp.value = 'cairotech';
      inp.dispatchEvent(new Event('input'));
    }
  });
  
  // Set destination
  inputs.forEach(function(inp) {
    if (inp.name === 'destination' || inp.value === '154.178.139.128' || inp.name === 'target') {
      inp.value = '$tunnelHost';
      inp.dispatchEvent(new Event('input'));
    }
  });
  
  // Read all input fields to understand the structure
  var allInputs = [];
  document.querySelectorAll('input').forEach(function(inp) {
    allInputs.push({name:inp.name, type:inp.type, value:inp.value, placeholder:inp.placeholder});
  });
  document.title = JSON.stringify(allInputs);
})())
"@
                $vp.SetValue($js)
                Start-Sleep -Milliseconds 500
                [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
                Write-Host "Injecting form fill..."
            }
            break
        }
    } catch {}
}

Start-Sleep -Seconds 3

# Read title to see all input fields
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') {
            Write-Host "INPUT FIELDS:"
            Write-Host $w.Current.Name
            break
        }
    } catch {}
}

Start-Sleep -Seconds 1

# Now take a screenshot to see the form state and CAPTCHA
$bounds = $chrome.Current.BoundingRectangle
$screenshot = New-Object System.Drawing.Bitmap([int]$bounds.Width, [int]$bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($screenshot)
$graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $screenshot.Size)
$screenshot.Save("E:\Projects\OmniStore_Multi-Tenant\.freebuff\freedns-form-filled.png")
$graphics.Dispose()
$screenshot.Dispose()
Write-Host "Screenshot saved to freedns-form-filled.png"
