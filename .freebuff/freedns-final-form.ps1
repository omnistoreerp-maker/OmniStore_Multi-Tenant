Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($class -eq 'Chrome_WidgetWin_1' -and $name -ne 'Freebuff Desktop' -and $name -ne '' -and $name -notmatch 'Brave') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) { Write-Output "ERROR: Chrome not found"; exit 1 }

# Navigate to subdomains page
$addrCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, 'OmniboxViewViews')
$addressBar = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addrCondition)
if ($addressBar) {
    $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $vp.SetValue("https://freedns.afraid.org/subdomain/")
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Seconds 5
}

# Click Add a subdomain
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.Hyperlink' -and $el.Current.Name -eq 'Add a subdomain') {
            $ip = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $ip.Invoke()
            Start-Sleep -Seconds 5
            break
        }
    } catch {}
}

Write-Output "=== Form page loaded ==="

# Fill Type = CNAME
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$comboBoxes = @()
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.ComboBox') { $comboBoxes += $el }
    } catch {}
}

if ($comboBoxes.Count -ge 1) {
    try {
        $ep = $comboBoxes[0].GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $ep.Expand()
        Start-Sleep -Milliseconds 500
        $items = $comboBoxes[0].FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($item in $items) {
            if ($item.Current.Name -eq 'CNAME') {
                $sp = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $sp.Select()
                Write-Output "Type = CNAME"
                Start-Sleep -Milliseconds 300
                break
            }
        }
        $ep.Collapse()
    } catch {}
}

# Fill Subdomain = cairotech
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit') {
            $rect = $el.Current.BoundingRectangle
            if ($rect.Y -gt 400 -and $rect.Y -lt 420) {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $vp.SetValue("cairotech")
                Write-Output "Subdomain = cairotech"
                break
            }
        }
    } catch {}
}

# Fill Domain = mooo.com
if ($comboBoxes.Count -ge 2) {
    try {
        $ep = $comboBoxes[1].GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $ep.Expand()
        Start-Sleep -Milliseconds 500
        $items = $comboBoxes[1].FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($item in $items) {
            if ($item.Current.Name -match 'mooo\.com') {
                $sp = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $sp.Select()
                Write-Output "Domain = mooo.com"
                Start-Sleep -Milliseconds 300
                break
            }
        }
        $ep.Collapse()
    } catch {}
}

# Fill Destination = tunnel UUID
$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit') {
            $rect = $el.Current.BoundingRectangle
            if ($rect.Y -gt 445 -and $rect.Y -lt 470) {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $vp.SetValue("7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com")
                Write-Output "Destination = tunnel UUID"
                break
            }
        }
    } catch {}
}

Write-Output "=== FORM READY ==="
Write-Output "All fields filled. CAPTCHA visible. Waiting for manual solve."
