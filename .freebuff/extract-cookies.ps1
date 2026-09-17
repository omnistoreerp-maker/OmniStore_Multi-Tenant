# Extract FreeDNS cookies from Chrome's cookie database
$chromeCookiePath = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Network\Cookies"
if (Test-Path $chromeCookiePath) {
    Write-Host "Chrome cookie DB found at: $chromeCookiePath"
    # Copy it to temp to avoid lock
    $tempCookie = "$env:TEMP\chrome_cookies_copy.db"
    Copy-Item $chromeCookiePath $tempCookie -Force
    Write-Host "Copied to: $tempCookie"
    Write-Host "Size: $((Get-Item $tempCookie).Length) bytes"
} else {
    Write-Host "Chrome cookie DB not found at default path"
    # Try other profiles
    $profiles = Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Default|Profile' }
    foreach ($p in $profiles) {
        $path = Join-Path $p.FullName "Network\Cookies"
        if (Test-Path $path) {
            Write-Host "Found: $path"
        }
        $path2 = Join-Path $p.FullName "Cookies"
        if (Test-Path $path2) {
            Write-Host "Found: $path2"
        }
    }
}
