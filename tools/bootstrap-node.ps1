param([switch]$RequireNpm)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root 'runtime\node'
$node = Join-Path $runtime 'node.exe'
if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows required' }
$npmCli = Join-Path $runtime 'node_modules\npm\bin\npm-cli.js'
if ((Test-Path $node) -and (-not $RequireNpm -or (Test-Path $npmCli))) {
  & $node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($systemNode -and -not $RequireNpm) {
  & $systemNode.Source -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
$base = 'https://nodejs.org/dist/latest-v24.x'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('tenmayurika-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  $sums = Join-Path $temp 'SHASUMS256.txt'
  & (Join-Path $PSScriptRoot "download-monitor.ps1") -Url "$base/SHASUMS256.txt" -Destination $sums -Label "Node.js SHA256 manifest" -HistoryPath (Join-Path $root "logs\download-history.jsonl")
  $entry = Get-Content $sums | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+node-v24\.[0-9.]+-win-x64\.zip$' } | Select-Object -First 1
  if (-not $entry) { throw 'Official Node 24 archive not found' }
  $parts = $entry -split '\s+'
  $name = $parts[1]
  $zip = Join-Path $temp $name
  & (Join-Path $PSScriptRoot "download-monitor.ps1") -Url "$base/$name" -Destination $zip -ExpectedSha256 $parts[0] -Label $name -HistoryPath (Join-Path $root "logs\download-history.jsonl")
  if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $parts[0].ToUpperInvariant()) { throw 'SHA256 mismatch' }
  Write-Host '[EXTRACT] Extracting archive...'
  Expand-Archive $zip -DestinationPath $temp -Force
  $source = Join-Path $temp ($name.Substring(0,$name.Length - 4))
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'Archive invalid' }
  if (-not (Test-Path (Join-Path $source 'node_modules\npm\bin\npm-cli.js'))) { throw 'Archive has no npm' }
  New-Item -ItemType Directory -Path (Split-Path $runtime -Parent) -Force | Out-Null
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  Move-Item $source $runtime
} finally { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
