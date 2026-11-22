'use strict';

/**
 * Wallpaper window glue: engine + widgets + audio source management.
 *
 * Audio strategy:
 *  1. Try the configured source (default: system loopback — visualizes
 *     Spotify / YouTube / VLC etc. without a microphone).
 *  2. If it fails, show a hint; main broadcasts 'audio:retry' when the user
 *     interacts elsewhere or presses "Reconnect audio" in Settings.
 *  3. Local file playback is self-contained; its metadata is reported to
 *     main (for lyrics + artwork) when the media overlay reports nothing.
 */

(async function () {
  const vis = window.FreewaveVisualizers.registry;
  let settings = await window.freewave.getSettings();
  let lyrics = null;
  const lyricClock = window.LyricSync.makeClock();
  let retryTimer = null;
  let lastLineIndex = -2;

  // ---------------------------------------------------------- engine init
  Engine.init(document.getElementById('vis'), settings, vis, settings.visualizer);

  // ---------------------------------------------------------- audio connect
  async function connectAudio() {
    const source = (settings.audio && settings.audio.source) || 'loopback';
    Widgets.showHint('Connecting to audio...');
    try {
      if (source === 'loopback') {
        await AudioManager.useLoopback();
        Widgets.hideHint();
      } else if (source === 'mic') {
        await AudioManager.useMic();
        Widgets.hideHint();
      } else if (source === 'file' && settings.audio.file) {
        await AudioManager.useFile(settings.audio.file);
        Widgets.hideHint();
        reportFileMetadata();
      } else {
        Widgets.showHint('Choose an audio file in Settings to visualize it');
      }
    } catch (err) {
      console.warn('[wallpaper] audio connect failed:', err.message);
      Widgets.showHint(hintFor(err.message, source));
    }
  }

  function hintFor(message, source) {
    if (source === 'loopback') {
      if (message === 'Capture was blocked') {
        return 'System audio capture was blocked - open Settings and press "Reconnect audio"';
      }
      if (message === 'System audio could not be captured') {
        return 'Could not capture system audio - try the microphone or file mode in Settings';
      }
      return 'Waiting for system audio - open Settings and press "Reconnect audio"';
    }
    if (source === 'mic') return 'Microphone unavailable - check Windows privacy settings';
    return 'Audio not connected';
  }

  /** Parse "Artist - Title.mp3" and hand it to main for lyrics/artwork. */
  function reportFileMetadata() {
    const ctrl = AudioManager.fileControls();
    if (!ctrl) return;
    const pathStr = (settings.audio && settings.audio.file) || '';
    const name = decodeURIComponent(pathStr.split(/[\\/]/).pop() || '');
    const base = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_/g, ' ').trim();
    const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    const waitAndSend = () => {
      window.freewave.setManualTrack({
        title: (m ? m[2] : base).trim(),
        artist: (m ? m[1] : '').trim(),
        album: '',
        duration: Math.round(ctrl.duration() || 0)
      });
    };
    // duration may not be ready the instant playback starts
    setTimeout(waitAndSend, 600);
    setTimeout(waitAndSend, 2500);
  }

  // ---------------------------------------------------------- settings
  function applySettings(next) {
    settings = next;
    Engine.applySettings(settings);
    Engine.setVisualizer(vis, settings.visualizer);
    AudioManager.applySettings(settings);
    Widgets.applySettings(settings);

    const desired = (settings.audio && settings.audio.source) || 'loopback';
    if (desired !== AudioManager.getMode()) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectAudio, 300);
    }
  }

  // ---------------------------------------------------------- IPC
  window.freewave.onSettings(applySettings);
  window.freewave.onAudioRetry(() => {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectAudio, 250);
  });

  window.freewave.onTrack((t) => Widgets.setTrack(t));

  window.freewave.onPosition((p) => {
    lyricClock.set(p);
    Widgets.setAnchor(p);
  });

  window.freewave.onLyrics((l) => {
    lyrics = l;
    lastLineIndex = -2;
  });

  window.freewave.onArtwork((a) => {
    // artwork arrives as a side-update after the track event
    Widgets.setArtUrl(a && a.artUrl);
  });

  // ---------------------------------------------------------- timers
  setInterval(() => {
    // current lyric line under the card
    if (lyrics && lyrics.synced && lyrics.lines.length) {
      const pos = lyricClock.get() + ((settings.lyrics && settings.lyrics.offset) || 0);
      const { cur, index } = window.LyricSync.currentAndNext(lyrics.lines, pos);
      if (index !== lastLineIndex) {
        lastLineIndex = index;
        Widgets.setLyric(cur);
      }
    } else {
      Widgets.setLyric('');
    }

    // diagnostics for the Settings audio meter
    window.freewave.reportAudioLevel({
      mode: AudioManager.getMode(),
      level: Number(AudioManager.level().toFixed(3)),
      signal: AudioManager.hasSignal()
    });
  }, 250);

  // ---------------------------------------------------------- boot
  Widgets.init(settings);
  setTimeout(connectAudio, 900);
})();
