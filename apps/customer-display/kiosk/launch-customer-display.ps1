<#
  launch-customer-display.ps1 — Dual-Screen mandate §2, §16, §87 (Oct 12 2026): open the AI PowerSalon customer display
  full-screen (kiosk) on the PORTABLE CUSTOMER MONITOR of a Windows POS computer, never on the employee's main screen.

  What it does
    1. Finds the monitors Windows reports. In "Duplicate these displays" mode Windows reports ONE screen — the script
       stops and says so: the customer would see the POS. Set "Extend these displays" (docs/CUSTOMER_DISPLAY_WINDOWS_SETUP.md).
    2. Picks the customer monitor: the non-main display (the right-most one when there are several), or the one you name
       with -Display.
    3. Starts Chrome (or Edge) in kiosk mode on that monitor with its OWN browser profile — no address bar, no tabs, no
       employee bookmarks, logins or extensions, and no POS session in that window (§10, §16).

  The display pairs itself with a code the owner types into the POS (Devices → Customer Displays); nothing secret is
  passed on this command line, and none is ever needed.

  Usage (PowerShell):
    .\launch-customer-display.ps1 -Url https://pos.example.com/customer-display/
    .\launch-customer-display.ps1 -Url https://pos.example.com/customer-display/ -Display 2 -Browser edge
  Or set APS_CUSTOMER_DISPLAY_URL once (System → About → Advanced system settings → Environment Variables) and run it
  with no arguments — e.g. from the Startup folder via launch-customer-display.cmd.
#>
[CmdletBinding()]
param(
  [string]$Url = $env:APS_CUSTOMER_DISPLAY_URL,
  [ValidateSet('auto', 'chrome', 'edge')][string]$Browser = 'auto',
  [int]$Display = 0,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

if (-not $Url) { Write-Error 'No display address. Pass -Url https://…/customer-display/ or set APS_CUSTOMER_DISPLAY_URL.'; exit 1 }
try { $u = [Uri]$Url } catch { Write-Error "Not an address: $Url"; exit 1 }
if ($u.Scheme -ne 'https' -and $u.Host -notin @('localhost', '127.0.0.1')) { Write-Error 'The customer display must be opened over https.'; exit 1 }
if ($u.Query -match '(?i)(token|password|secret)=') { Write-Error 'Do not put a token or password in the display address — the display pairs itself with a code.'; exit 1 }

Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
if ($screens.Count -lt 2) {
  Write-Warning 'Windows reports only ONE display. Either the customer monitor is not connected, or Windows is set to "Duplicate these displays" (the customer would see the POS).'
  Write-Warning 'Fix: press Windows+P and choose "Extend", or Settings → System → Display → "Extend these displays". Then run this again.'
  exit 2
}
if ($Display -gt 0) {
  if ($Display -gt $screens.Count) { Write-Error "There is no display $Display (Windows reports $($screens.Count))."; exit 1 }
  $target = $screens[$Display - 1]
  if ($target.Primary) { Write-Error "Display $Display is the MAIN display (the employee POS). Choose the customer monitor."; exit 1 }
} else {
  $target = $screens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X } | Select-Object -Last 1
}
$b = $target.Bounds

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$candidates = switch ($Browser) { 'chrome' { $chrome } 'edge' { $edge } default { $chrome + $edge } }
$exe = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $exe) { Write-Error 'Neither Google Chrome nor Microsoft Edge was found.'; exit 1 }

# its own profile: never the employee's browser (no logins, bookmarks, extensions, or the POS session)
$profileDir = Join-Path $env:LOCALAPPDATA 'AIPowerSalon\CustomerDisplayBrowser'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$browserArgs = @(
  "--kiosk", $u.AbsoluteUri,
  "--window-position=$($b.X),$($b.Y)", "--window-size=$($b.Width),$($b.Height)",
  "--user-data-dir=$profileDir",
  "--no-first-run", "--no-default-browser-check", "--noerrdialogs", "--disable-session-crashed-bubble",
  "--disable-infobars", "--disable-translate", "--disable-pinch", "--overscroll-history-navigation=0",
  "--autoplay-policy=no-user-gesture-required"
)
Write-Host "Customer display → $($target.DeviceName) at $($b.X),$($b.Y) ($($b.Width)×$($b.Height)) with $(Split-Path $exe -Leaf)"
if ($DryRun) { Write-Host "$exe $($browserArgs -join ' ')"; exit 0 }
Start-Process -FilePath $exe -ArgumentList $browserArgs
