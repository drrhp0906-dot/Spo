# Freewave - Windows "Now Playing" poller (System Media Transport Controls)
#
# Emits JSON lines on stdout that the Freewave main process reads:
#   {"event":"ready"}
#   {"event":"track","title":"...","artist":"...","album":"...","status":"Playing","duration":214.5}
#   {"event":"position","position":42.1,"age":0.8,"rate":1.0,"status":"Playing","duration":214.5}
#   {"event":"idle"}
#   {"event":"fatal","message":"smtc-unavailable"}
#
# Usage:
#   smtc.ps1            -> run the polling loop (one line every ~600 ms)
#   smtc.ps1 toggle     -> one-shot play/pause toggle, then exit
#
# Works with Spotify (desktop & Store), Chrome/Edge (YouTube etc.), VLC,
# foobar2000, MusicBee... anything that reports to Windows media overlay.

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

# Project WinRT types
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
  $netTask = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
  $null = $netTask.Wait(10000)
  return $netTask.Result
}

$StatusPlaying = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]::Playing
$ManagerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$MediaPropsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

# --------------------------------------------------------------- toggle mode
if ($args.Count -gt 0 -and $args[0] -eq 'toggle') {
  try {
    $mgr = Await ($ManagerType::RequestAsync()) ($ManagerType)
    $sessions = @($mgr.GetSessions())
    $s = $sessions | Where-Object { $_.PlaybackStatus -eq $StatusPlaying } | Select-Object -First 1
    if (-not $s -and $sessions.Count -gt 0) { $s = $sessions[0] }
    if ($s) {
      $asAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
      $null = $asAction.Invoke($null, @($s.TryTogglePlayPauseAsync()))
      Write-Output '{"event":"toggled"}'
    } else {
      Write-Output '{"event":"toggled","message":"no-session"}'
    }
  } catch {
    Write-Output '{"event":"error","message":"toggle failed"}'
  }
  exit 0
}

# --------------------------------------------------------------- poller mode
try {
  $mgr = Await ($ManagerType::RequestAsync()) ($ManagerType)
} catch {
  Write-Output '{"event":"fatal","message":"smtc-unavailable"}'
  exit 1
}

Write-Output '{"event":"ready"}'

$lastKey = ''
$idleCount = 0

while ($true) {
  try {
    $sessions = @($mgr.GetSessions())
    $s = $sessions | Where-Object { $_.PlaybackStatus -eq $StatusPlaying } | Select-Object -First 1
    if (-not $s -and $sessions.Count -gt 0) { $s = $sessions[0] }

    if ($null -eq $s) {
      $idleCount++
      if ($idleCount -ge 4 -or $lastKey -ne '') {
        Write-Output '{"event":"idle"}'
        $idleCount = 0
      }
      $lastKey = ''
    } else {
      $idleCount = 0
      $mp = Await ($s.TryGetMediaPropertiesAsync()) ($MediaPropsType)
      $tl = $s.GetTimelineProperties()
      $status = [string]$s.PlaybackStatus
      $title = [string]$mp.Title
      $artist = [string]$mp.Artist

      $age = 0
      try {
        $age = [math]::Round(([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime.UtcDateTime).TotalSeconds, 2)
        if ($age -lt 0) { $age = 0 }
      } catch {}

      $duration = 0
      try { $duration = [math]::Round($tl.EndTime.TotalSeconds, 1) } catch {}
      if ($duration -lt 0) { $duration = 0 }

      $key = "$artist|$title"
      if ($key -ne $lastKey) {
        $lastKey = $key
        $trackObj = [pscustomobject]@{
          event = 'track'
          title = $title
          artist = $artist
          album = [string]$mp.AlbumTitle
          status = $status
          duration = $duration
        }
        Write-Output ($trackObj | ConvertTo-Json -Compress)
      }

      $posObj = [pscustomobject]@{
        event = 'position'
        position = [math]::Round($tl.Position.TotalSeconds, 2)
        age = $age
        rate = [double]$tl.PlaybackRate
        status = $status
        duration = $duration
      }
      Write-Output ($posObj | ConvertTo-Json -Compress)
    }
  } catch {}

  Start-Sleep -Milliseconds 600
}
