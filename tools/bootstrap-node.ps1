param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root 'runtime\node'
$node = Join-Path $runtime 'node.exe'
$version = 'latest-v24.x'
if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows required' }
if (Test-Path $node) {
  & $node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
$systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($systemNode) {
  & $systemNode.Source -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
$base = "https://nodejs.org/dist/$version"
$zipName = $null
$temp = Join-Path ([IO.Path]::GetTempPath()) ("tenmayurika-node-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  $sums = Join-Path $temp 'SHASUMS256.txt'
  Write-Host 'Downloading official Node.js portable runtime...'
  Invoke-WebRequest "$base/SHASUMS256.txt" -OutFile $sums -UseBasicParsing
  $entry = Get-Content $sums | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+node-v24\.[0-9.]+-win-x64\.zip
  $entry = Get-Content $sums | Where-Object { $_ -match ("^[0-9a-fA-F]{64}\s+" + [regex]::Escape($zipName) + "$") } | Select-Object -First 1
  if (-not $entry) { throw 'Official checksum missing' }
  $expected = ($entry -split '\s+')[0].ToUpperInvariant()
  $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw 'Node.js SHA256 mismatch' }
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $source = Join-Path $temp ($zipName -replace '\.zip
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'Node.js archive invalid' }
  $parent = Split-Path $runtime -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  Move-Item -Path $source -Destination $runtime
  Write-Host 'Portable Node.js installed.'
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
 } | Select-Object -First 1
  if (-not $entry) { throw 'Official Node.js v24 checksum missing' }
  $zipName = ($entry -split '\s+')[1]
  $zip = Join-Path $temp $zipName
  Invoke-WebRequest "$base/$zipName" -OutFile $zip -UseBasicParsing
  $entry = Get-Content $sums | Where-Object { $_ -match ("^[0-9a-fA-F]{64}\s+" + [regex]::Escape($zipName) + "$") } | Select-Object -First 1
  if (-not $entry) { throw 'Official checksum missing' }
  $expected = ($entry -split '\s+')[0].ToUpperInvariant()
  $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw 'Node.js SHA256 mismatch' }
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $source = Join-Path $temp "node-$version-win-x64"
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'Node.js archive invalid' }
  $parent = Split-Path $runtime -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  Move-Item -Path $source -Destination $runtime
  Write-Host 'Portable Node.js installed.'
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
, '')
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'Node.js archive invalid' }
  $parent = Split-Path $runtime -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  Move-Item -Path $source -Destination $runtime
  Write-Host 'Portable Node.js installed.'
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
 } | Select-Object -First 1
  if (-not $entry) { throw 'Official Node.js v24 checksum missing' }
  $zipName = ($entry -split '\s+')[1]
  $zip = Join-Path $temp $zipName
  Invoke-WebRequest "$base/$zipName" -OutFile $zip -UseBasicParsing
  $entry = Get-Content $sums | Where-Object { $_ -match ("^[0-9a-fA-F]{64}\s+" + [regex]::Escape($zipName) + "$") } | Select-Object -First 1
  if (-not $entry) { throw 'Official checksum missing' }
  $expected = ($entry -split '\s+')[0].ToUpperInvariant()
  $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash
  if ($actual -ne $expected) { throw 'Node.js SHA256 mismatch' }
  Expand-Archive -Path $zip -DestinationPath $temp -Force
  $source = Join-Path $temp "node-$version-win-x64"
  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'Node.js archive invalid' }
  $parent = Split-Path $runtime -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
  Move-Item -Path $source -Destination $runtime
  Write-Host 'Portable Node.js installed.'
} finally {
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
