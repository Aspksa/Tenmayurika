$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root 'runtime\python'
$exe = Join-Path $runtime 'python.exe'
if (Test-Path $exe) {
  & $exe --version
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
$found = Get-Command python.exe -ErrorAction SilentlyContinue
if ($found) {
  & $found.Source -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
  if ($LASTEXITCODE -eq 0) { exit 0 }
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 required for portable Python' }
$version = '3.13.9'
$filename = "python-$version-embed-amd64.zip"
$url = "https://www.python.org/ftp/python/$version/$filename"
$temp = Join-Path ([IO.Path]::GetTempPath()) ('tenmayurika-python-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  $archive = Join-Path $temp $filename
  Write-Host 'Downloading official Python embeddable runtime...'
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
  $extract = Join-Path $temp 'python'
  Expand-Archive -Path $archive -DestinationPath $extract -Force
  $testExe = Join-Path $extract 'python.exe'
  if (-not (Test-Path $testExe)) { throw 'Python archive is incomplete' }
  & $testExe -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'
  if ($LASTEXITCODE -ne 0) { throw 'Downloaded Python failed self-check' }
  New-Item -ItemType Directory -Path (Split-Path $runtime -Parent) -Force | Out-Null
  if (Test-Path $runtime) { throw 'Existing Python runtime is invalid; refusing to overwrite it' }
  Move-Item -Path $extract -Destination $runtime
  Write-Host 'Portable Python is ready.'
} finally { Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue }
