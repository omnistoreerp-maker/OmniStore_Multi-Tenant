# READ-ONLY Cloudflare dashboard API reader.
# Opens a NEW tab in the existing Chrome window (does not touch the user's active tab),
# navigates to dash.cloudflare.com API GET endpoints using the logged-in session,
# and reports each JSON response via the window title. No mutations.
param(
    [string[]]$Paths = @(),
    [int]$WaitLoad = 8,
    [switch]$CloseTabAtEnd
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement

function Find-Chrome {
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $wins) {
        try {
            if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -match 'Chrome') { return $w }
        } catch {}
    }
    return $null
}

function Find-Omnibox($chrome) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
    return $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Set-Omnibox($value) {
    $omni = Find-Omnibox $chrome
    if (-not $omni) { Write-Output "ERROR: NoOmnibox"; return $false }
    try {
        $vp = $omni.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $vp.SetValue($value)
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        return $true
    } catch {
        Write-Output ("ERROR: OmniboxSetFailed: " + $_.Exception.Message)
        return $false
    }
}

$chrome = Find-Chrome
if (-not $chrome) { Write-Output "ERROR: NoChrome"; exit 1 }

# Open a new tab so the user's current tab stays untouched
$chrome.SetFocus()
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait("^t")
Start-Sleep -Seconds 1

foreach ($p in $Paths) {
    $url = "https://dash.cloudflare.com" + $p
    Set-Omnibox $url | Out-Null
    Write-Output ("GET " + $p)
    Start-Sleep -Seconds $WaitLoad
    # Smuggle the page body out through the window title (page-context JS)
    $js = 'javascript:void(document.title="API<<" + document.body.innerText.substring(0,1800))'
    Set-Omnibox $js | Out-Null
    Start-Sleep -Seconds 3
    $chrome = Find-Chrome
    if ($chrome) { Write-Output ("RESULT: " + $chrome.Current.Name) }
    Write-Output "----"
}

if ($CloseTabAtEnd) {
    [System.Windows.Forms.SendKeys]::SendWait("^w")
    Start-Sleep -Milliseconds 500
}
