param(
  [string]$Version = "v1.11.2"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path $env:TEMP "obxodik-tgws-build"
$repo = Join-Path $work "tg-ws-proxy-$($Version.TrimStart('v'))"
$venv = Join-Path $work "venv"
$out = Join-Path $root "resources\tgws"

New-Item -ItemType Directory -Force $work | Out-Null
New-Item -ItemType Directory -Force $out | Out-Null

Write-Host "Downloading tg-ws-proxy $Version..."
$archive = Join-Path $work "src.tar.gz"
Invoke-WebRequest -Uri "https://github.com/Flowseal/tg-ws-proxy/archive/refs/tags/$Version.tar.gz" -OutFile $archive
tar -xzf $archive -C $work

if (-not (Test-Path $venv)) {
  python -m venv $venv
}

Write-Host "Installing build dependencies..."
& "$venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check pyinstaller "httpx[http2]" cryptography certifi

$entry = Join-Path $work "tgws_cli.py"
@'
from proxy.tg_ws_proxy import main

if __name__ == "__main__":
    main()
'@ | Set-Content -Encoding UTF8 $entry

$icon = Join-Path $root "resources\icon.ico"

Write-Host "Building headless proxy..."
& "$venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --onedir --console `
  --name tgws-core `
  --paths $repo `
  --collect-submodules proxy `
  --collect-submodules httpx `
  --collect-submodules h2 `
  --collect-all certifi `
  --exclude-module tkinter `
  --exclude-module customtkinter `
  --exclude-module pystray `
  --exclude-module PIL `
  --exclude-module psutil `
  --icon $icon `
  --distpath (Join-Path $work "dist-dir") `
  --workpath (Join-Path $work "work-dir") `
  --specpath $work `
  $entry

Remove-Item (Join-Path $out "tgws-core.exe") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $out "_internal") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $work "dist-dir\tgws-core\*") $out -Recurse -Force
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Flowseal/tg-ws-proxy/$Version/LICENSE" -OutFile (Join-Path $out "LICENSE.txt")

$hash = (Get-FileHash (Join-Path $out "tgws-core.exe") -Algorithm SHA256).Hash
Write-Host "Done: resources\tgws\tgws-core.exe"
Write-Host "SHA256: $hash"
