param(
  [string]$Root = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$Root = $Root.TrimEnd('\')

$runtime = Join-Path $Root 'runtime'
$nodeDir = Join-Path $runtime 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'

if (Test-Path $nodeExe) {
  Write-Host 'Node.js already present in runtime folder.'
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtime | Out-Null

# 复用上次“已下载、已解压但未重命名”的目录,避免重复下载
$partial = Get-ChildItem -Path $runtime -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($partial) {
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Rename-Item -Path $partial.FullName -NewName 'node'
  Write-Host 'Node.js reused from a previous download.'
  exit 0
}

$pinned = if ($env:BYYXT_NODE_VERSION) { $env:BYYXT_NODE_VERSION } else { 'v24.19.0' }

function Get-LtsVersion {
  $info = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
  $lts = $info | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $lts) { throw 'Cannot resolve Node.js LTS version.' }
  return $lts.version
}

function Install-Node([string]$v) {
  $zipName = "node-$v-win-x64.zip"
  $zipUrl = "https://nodejs.org/dist/$v/$zipName"
  Write-Host "Downloading $zipUrl ..."
  $zipPath = Join-Path $runtime $zipName
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -TimeoutSec 600
  Write-Host 'Extracting...'
  Expand-Archive -Path $zipPath -DestinationPath $runtime -Force
  Remove-Item $zipPath -Force
  $extracted = Join-Path $runtime "node-$v-win-x64"
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  Rename-Item -Path $extracted -NewName 'node'
  Write-Host "Node.js $v installed to: $nodeDir"
}

try {
  Install-Node $pinned
} catch {
  Write-Host "Pinned version $pinned failed, falling back to latest LTS..."
  Install-Node (Get-LtsVersion)
}
