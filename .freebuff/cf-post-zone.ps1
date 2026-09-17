# Creates PENDING zone spdy.io in account dc14c66e... via dashboard API (session-auth),
# then verifies via GET. No NS/DNS change, no effect on the old account's active zone.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

function Find-Chrome {
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $wins) {
        try { if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') { return $w } } catch {}
    }
    return $null
}
function Set-Omnibox($value) {
    $chrome = Find-Chrome
    if (-not $chrome) { Write-Output "ERROR: NoChrome"; exit 1 }
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
    $omni = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $omni) { Write-Output "ERROR: NoOmnibox"; exit 1 }
    $vp = $omni.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $vp.SetValue($value)
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}

# 1) POST /zones  (pending zone creation)
$js = 'javascript:void(fetch("/api/v4/zones",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"spdy.io",account:{id:"dc14c66e44d9620f70f72e138ba7cc33"},type:"full",jump_start:false})}).then(function(r){return r.json()}).then(function(j){var out="SUCCESS=false";if(j.success&&j.result){out=j.result.status+"|id="+j.result.id.slice(0,8)+"|ns="+((j.result.name_servers||[]).join(","))}else if(j.errors){out="ERR:"+JSON.stringify(j.errors).slice(0,200)}document.title="POST:"+out}).catch(function(e){document.title="POSTFAIL:"+e.message}))'
Set-Omnibox $js
Start-Sleep -Seconds 6
$chrome = Find-Chrome
Write-Output ("STEP1 " + $chrome.Current.Name.Substring(0, [Math]::Min(260, $chrome.Current.Name.Length)))

# 2) Verify via GET (reliable navigation route)
Set-Omnibox "https://dash.cloudflare.com/api/v4/zones?name=spdy.io"
Start-Sleep -Seconds 5
Set-Omnibox "javascript:void(document.title=`"Z:`"+document.body.innerText.slice(0,600).replace(/[\r\n]+/g,' '))"
Start-Sleep -Seconds 3
$chrome = Find-Chrome
Write-Output ("STEP2 " + $chrome.Current.Name.Substring(0, [Math]::Min(700, $chrome.Current.Name.Length)))
