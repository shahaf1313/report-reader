# Headless Chrome helper for local checks (Windows).
#   ./scripts/headless.ps1 -Url http://localhost:8000/tests/lib.test.html -Dom
#   ./scripts/headless.ps1 -Url http://localhost:8000/ -Shot out.png -Size 390,844
param(
  [Parameter(Mandatory)] [string] $Url,
  [switch] $Dom,
  [string] $Shot,
  [string] $Size = '390,844',
  [switch] $Dark,
  [int] $Budget = 8000
)
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome not found' }

$profile = Join-Path $env:TEMP ('rr-headless-' + [guid]::NewGuid())
$args = @('--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  "--user-data-dir=$profile", "--virtual-time-budget=$Budget", '--hide-scrollbars',
  "--window-size=$Size", '--force-device-scale-factor=2')
if ($Dark) { $args += '--force-dark-mode', '--blink-settings=preferredColorScheme=0' }
if ($Dom) { $args += '--dump-dom' }
if ($Shot) { $args += "--screenshot=$((Resolve-Path -LiteralPath (Split-Path -Parent $Shot)).Path)\$(Split-Path -Leaf $Shot)" }
$args += $Url

$out = "$profile.out"
$p = Start-Process -FilePath $chrome -ArgumentList $args -RedirectStandardOutput $out -RedirectStandardError "$profile.err" -Wait -PassThru -NoNewWindow
if ($Dom) { Get-Content $out -Raw -Encoding utf8 }
Remove-Item -Recurse -Force $profile, $out, "$profile.err" -ErrorAction SilentlyContinue
exit $p.ExitCode
