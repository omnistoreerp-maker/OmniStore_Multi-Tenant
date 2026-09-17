# Cloudflare dashboard driver: navigate omnibox + eval JS in page context + read window title.
# Uses the proven UIA omnibox approach from .freebuff/cf-*.ps1 scripts.
param(
    [string]$Url = "",
    [string]$Js = "",
    [int]$WaitAfterNav = 8,
    [int]$WaitAfterJs = 3
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
    $chrome = Find-Chrome
    if (-not $chrome) { Write-Output "ERROR: NoChrome"; exit 1 }
    $omni = Find-Omnibox $chrome
    if (-not $omni) { Write-Output "ERROR: NoOmnibox"; exit 1 }
    try {
        $vp = $omni.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $vp.SetValue($value)
        Start-Sleep -Milliseconds 300
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        return $true
    } catch {
        Write-Output ("ERROR: OmniboxSetFailed: " + $_.Exception.Message)
        exit 1
    }
}

if ($Url -ne "") {
    Set-Omnibox $Url | Out-Null
    Write-Output ("NAV: " + $Url)
    Start-Sleep -Seconds $WaitAfterNav
}

if ($Js -ne "") {
    if (-not $Js.StartsWith("javascript:")) { $Js = "javascript:" + $Js }
    Set-Omnibox $Js | Out-Null
    Start-Sleep -Seconds $WaitAfterJs
}

# Report current page title (carries JS-set data)
$chrome = Find-Chrome
if ($chrome) {
    $name = $chrome.Current.Name
    Write-Output ("TITLE: " + $name)
} else {
    Write-Output "TITLE: (chrome window not found)"
}
