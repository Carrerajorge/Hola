$ErrorActionPreference = 'Stop'

$Repo = 'Carrerajorge/Hola'
$Asset = 'iliagpt-node-windows.exe'
$Api = "https://api.github.com/repos/$Repo/releases/latest"

$release = Invoke-RestMethod -Uri $Api -Headers @{ 'User-Agent' = 'iliagpt-node-installer' }
$asset = $release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
if (-not $asset) {
  throw "Could not find asset $Asset in latest release. Did you tag iliagpt-node-vX.Y.Z ?"
}

$destDir = "$env:LOCALAPPDATA\\iliagpt-node"
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir 'iliagpt-node.exe'

Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest

Write-Host "Downloaded to: $dest"
Write-Host "Add to PATH (example): setx PATH `"$env:PATH;$destDir`""
