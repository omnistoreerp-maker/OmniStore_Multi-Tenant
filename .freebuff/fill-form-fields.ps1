Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$chromeWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

$chrome = $null
foreach ($w in $chromeWindows) {
    try {
        if ($w.Current.ClassName -eq 'Chrome_WidgetWin_1' -and $w.Current.Name -ne 'Freebuff Desktop' -and $w.Current.Name -ne '') {
            $chrome = $w
            break
        }
    } catch {}
}

if (-not $chrome) { Write-Output "ERROR: Chrome not found"; exit 1 }

$allElements = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)

# Step 1: Change Type ComboBox from A to CNAME
Write-Output "=== Step 1: Change Type to CNAME ==="
$comboBoxes = @()
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.ComboBox') {
            $comboBoxes += $el
        }
    } catch {}
}

if ($comboBoxes.Count -ge 1) {
    $typeCombo = $comboBoxes[0]
    try {
        $selPattern = $typeCombo.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
        $items = $selPattern.Current.GetSelection()
        Write-Output "Current type selection: $($items[0].Current.Name)"
    } catch {}
    
    try {
        $expandPattern = $typeCombo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $expandPattern.Expand()
        Write-Output "Type dropdown expanded"
        Start-Sleep -Milliseconds 500
        
        # Find CNAME option
        $typeItems = $typeCombo.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($item in $typeItems) {
            try {
                $itemName = $item.Current.Name
                if ($itemName -eq 'CNAME') {
                    $selItem = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                    $selItem.Select()
                    Write-Output "Selected CNAME"
                    Start-Sleep -Milliseconds 300
                    break
                }
            } catch {}
        }
        $expandPattern.Collapse()
    } catch {
        Write-Output "Type dropdown interaction failed: $_"
    }
}

# Step 2: Enter Subdomain
Write-Output "=== Step 2: Enter Subdomain ==="
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit') {
            $rect = $el.Current.BoundingRectangle
            if ($rect.Y -gt 400 -and $rect.Y -lt 420) {
                # This is the subdomain field (Y=410)
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $vp.SetValue("cairotech")
                Write-Output "Subdomain set to: cairotech"
                break
            }
        }
    } catch {}
}

# Step 3: Change Domain ComboBox to mooo.com
Write-Output "=== Step 3: Change Domain to mooo.com ==="
if ($comboBoxes.Count -ge 2) {
    $domainCombo = $comboBoxes[1]
    try {
        $expandPattern = $domainCombo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        $expandPattern.Expand()
        Write-Output "Domain dropdown expanded"
        Start-Sleep -Milliseconds 500
        
        # Find mooo.com option
        $domainItems = $domainCombo.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($item in $domainItems) {
            try {
                $itemName = $item.Current.Name
                if ($itemName -match 'mooo\.com') {
                    $selItem = $item.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                    $selItem.Select()
                    Write-Output "Selected: $itemName"
                    Start-Sleep -Milliseconds 300
                    break
                }
            } catch {}
        }
        $expandPattern.Collapse()
    } catch {
        Write-Output "Domain dropdown interaction failed: $_"
    }
}

# Step 4: Change Destination to tunnel UUID
Write-Output "=== Step 4: Set Destination ==="
foreach ($el in $allElements) {
    try {
        if ($el.Current.ControlType.ProgrammaticName -eq 'ControlType.Edit') {
            $rect = $el.Current.BoundingRectangle
            if ($rect.Y -gt 445 -and $rect.Y -lt 470) {
                # This is the destination field (Y=458)
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                $vp.SetValue("7809c05f-bba1-4213-8a0a-291613092a7b.cfargotunnel.com")
                Write-Output "Destination set to tunnel UUID"
                break
            }
        }
    } catch {}
}

Write-Output "=== Form filled (except CAPTCHA) ==="
Write-Output "CAPTCHA still needs to be solved manually."
