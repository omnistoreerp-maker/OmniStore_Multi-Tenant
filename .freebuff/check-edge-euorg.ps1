Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

$automation = [System.Windows.Automation.AutomationElement]
$root = $automation::RootElement
$allWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)

foreach ($w in $allWindows) {
    try {
        $name = $w.Current.Name
        $class = $w.Current.ClassName
        if ($name -and ($name -match 'Edge|edge|EU\.org|nic\.eu|Validate|Contact|OS774' -or $class -match 'Edge')) {
            Write-Host "Window: [$class] $name"
        }
    } catch {}
}
