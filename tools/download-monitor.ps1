param(
 [Parameter(Mandatory=$true)][string]$Url,
 [Parameter(Mandatory=$true)][string]$Destination,
 [string]$ExpectedSha256='',
 [string]$Label='',
 [int]$MaxAttempts=3,
 [string]$HistoryPath=''
)
$ErrorActionPreference='Stop'
if ($Url -notmatch '^https://') { throw 'Only HTTPS downloads are permitted' }
if ($MaxAttempts -lt 1 -or $MaxAttempts -gt 10) { throw 'MaxAttempts must be 1..10' }
if ($ExpectedSha256 -and $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA256' }
$dir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))
[IO.Directory]::CreateDirectory($dir)|Out-Null
if (-not $HistoryPath) { $HistoryPath=Join-Path $dir 'download-history.jsonl' }
$name=if($Label){$Label}else{[IO.Path]::GetFileName($Destination)}
$partial=$Destination+'.part'
$started=[DateTimeOffset]::UtcNow
$bytesThisRun=0L
$timer=[Diagnostics.Stopwatch]::StartNew()
$success=$false
$lastError=''
function Record-Event($state,$detail,$bytes,$elapsed) {
 $item=[ordered]@{time=[DateTimeOffset]::UtcNow.ToString('o');name=$name;source=([uri]$Url).Host;state=$state;bytes=[long]$bytes;elapsedSeconds=[math]::Round($elapsed,2);detail=$detail}
 $line=ConvertTo-Json -InputObject $item -Compress -Depth 4
 Add-Content -LiteralPath $HistoryPath -Value $line -Encoding UTF8
}
try {
 Record-Event 'queued' '' 0 0
 for($attempt=1;$attempt -le $MaxAttempts;$attempt++){
  $response=$null;$stream=$null;$output=$null
  try {
   $offset=if(Test-Path -LiteralPath $partial){(Get-Item -LiteralPath $partial).Length}else{0L}
   $handler=[Net.Http.HttpClientHandler]::new()
   $client=[Net.Http.HttpClient]::new($handler)
   $client.Timeout=[TimeSpan]::FromMinutes(30)
   try {
    $request=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,$Url)
    if($offset -gt 0){$request.Headers.Range=[Net.Http.Headers.RangeHeaderValue]::new($offset,$null)}
    $response=$client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $status=[int]$response.StatusCode
    if($status -ne 200 -and $status -ne 206){throw "HTTP $status"}
    $append=$offset -gt 0 -and $status -eq 206 -and $response.Content.Headers.ContentRange.From -eq $offset
    if($status -eq 206 -and $offset -gt 0 -and -not $append){throw 'Invalid Content-Range'}
    if(-not $append){$offset=0L}
    $expected=$response.Content.Headers.ContentLength
    if($null -ne $expected){$expected=[long]$expected+$offset}
    $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Destination)))
    if($null -ne $expected -and $drive.AvailableFreeSpace -lt ($expected-$offset+64MB)){throw 'Insufficient disk space'}
    $stream=$response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $mode=if($append){[IO.FileMode]::Append}else{[IO.FileMode]::Create}
    $output=[IO.FileStream]::new($partial,$mode,[IO.FileAccess]::Write,[IO.FileShare]::None)
    Record-Event 'downloading' "attempt $attempt" $offset $timer.Elapsed.TotalSeconds
    $buffer=[byte[]]::new(65536);$lastReport=[Diagnostics.Stopwatch]::StartNew();$windowBytes=0L
    while(($count=$stream.Read($buffer,0,$buffer.Length)) -gt 0){
     $output.Write($buffer,0,$count);$bytesThisRun+=$count;$windowBytes+=$count
     if($lastReport.Elapsed.TotalMilliseconds -ge 500){
      $speed=$windowBytes/$lastReport.Elapsed.TotalSeconds/1MB
      $current=$offset+$output.Length-$(if($append){$offset}else{0})
      $totalLabel=if($null -ne $expected){" / $([math]::Round($expected/1MB,1)) MB"}else{''}
      Write-Host ("  ↓ {0}: {1:N1}{2} MB | {3:N2} MB/s | {4}" -f $name,($output.Length/1MB),$totalLabel,$speed,([uri]$Url).Host)
      $windowBytes=0;$lastReport.Restart()
     }
    }
    $output.Flush($true);$output.Dispose();$output=$null
    if($null -ne $expected -and (Get-Item -LiteralPath $partial).Length -ne $expected){throw 'Incomplete transfer'}
    if($ExpectedSha256){
     Record-Event 'verifying' 'SHA256' (Get-Item -LiteralPath $partial).Length $timer.Elapsed.TotalSeconds
     $actual=(Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash
     if($actual -ne $ExpectedSha256.ToUpperInvariant()){Remove-Item -LiteralPath $partial -Force;throw 'SHA256 mismatch'}
    }
    Move-Item -LiteralPath $partial -Destination $Destination -Force
    $success=$true
    Record-Event 'complete' 'Verified transfer' (Get-Item -LiteralPath $Destination).Length $timer.Elapsed.TotalSeconds
    Write-Host ("  ✓ {0}: {1:N1} MB in {2:N1}s" -f $name,((Get-Item -LiteralPath $Destination).Length/1MB),$timer.Elapsed.TotalSeconds)
    break
   }finally{
    if($output){$output.Dispose()}
    if($stream){$stream.Dispose()}
    if($response){$response.Dispose()}
    if($request){$request.Dispose()}
    $client.Dispose();$handler.Dispose()
   }
  }catch{
   $lastError=$_.Exception.Message
   Record-Event 'retry' $lastError $bytesThisRun $timer.Elapsed.TotalSeconds
   Write-Warning ("Download {0}, attempt {1}/{2}: {3}" -f $name,$attempt,$MaxAttempts,$lastError)
   if($lastError -eq 'SHA256 mismatch' -or $lastError -eq 'Insufficient disk space'){break}
   if($attempt -lt $MaxAttempts){Start-Sleep -Seconds ([math]::Min(12,2*$attempt))}
  }
 }
 if(-not $success){throw "Download failed: $lastError"}
}finally{
 $timer.Stop()
 $report=[ordered]@{name=$name;success=$success;networkBytes=$bytesThisRun;seconds=[math]::Round($timer.Elapsed.TotalSeconds,2);averageMbps=if($timer.Elapsed.TotalSeconds -gt 0){[math]::Round($bytesThisRun/$timer.Elapsed.TotalSeconds/1MB,2)}else{0}}
 Write-Host ('DOWNLOAD REPORT '+(ConvertTo-Json -InputObject $report -Compress))
}
