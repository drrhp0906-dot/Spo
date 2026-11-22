'use strict';

/**
 * Theater mode: full-screen visualizer + album art + big synced lyrics.
 * Esc or the close button exits. Audio capture is independent from the
 * wallpaper window (each renderer owns its MediaStream).
 */

(async function () {
  const vis = window.FreewaveVisualizers.registry;
  let settings = await window.freewave.getSettings();
  let lyrics = null;
  let lastLineIndex = -2;
  const clock = window.LyricSync.makeClock();

  const artEl = document.getElementById('art');
  const artWrap = document.getElementById('art-wrap');
  const backdrop = document.getElementById('backdrop');
  const tStatus = document.getElementById('t-status');
  const tTitle = document.getElementById('t-title');
  const tArtist = document.getElementById('t-artist');
  const lCur = document.getElementById('l-current');
  const lNext = document.getElementById('l-next');

  Engine.init(document.getElementById('vis'), settings, vis, settings.visualizer);

  async function connectAudio() {
    const source = (settings.audio && settings.audio.source) || 'loopback';
    try {
      if (source === 'loopback') await AudioManager.useLoopback();
      else if (source === 'mic') await AudioManager.useMic();
      else if (source === 'file' && settings.audio.file) await AudioManager.useFile(settings.audio.file);
      document.body.classList.remove('audio-dead');
    } catch (err) {
      console.warn('[theater] audio failed:', err.message);
      document.body.classList.add('audio-dead');
    }
  }

  function applySettings(next) {
    settings = next;
    Engine.applySettings(settings);
    Engine.setVisualizer(vis, settings.visualizer);
    AudioManager.applySettings(settings);
    const desired = (settings.audio && settings.audio.source) || 'loopback';
    if (desired !== AudioManager.getMode()) setTimeout(connectAudio, 300);
  }

  window.freewave.onSettings(applySettings);
  window.freewave.onAudioRetry(connectAudio);

  window.freewave.onTrack((t) => {
    const paused = t && t.status && t.status !== 'Playing';
    tStatus.textContent = paused ? (t.status || 'Paused') : 'Playing';
    tStatus.classList.toggle('paused', !!paused);
    tTitle.textContent = (t && t.title) || 'Nothing playing';
    tArtist.textContent = (t && t.artist) || 'Play something in Spotify, YouTube or any player';

    const url = t && t.artUrl;
    artWrap.classList.toggle('has-art', !!url);
    if (url) {
      artEl.src = url;
      backdrop.classList.add('on');
      backdrop.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    } else {
      backdrop.classList.remove('on');
    }
  });

  window.freewave.onPosition((p) => clock.set(p));
  window.freewave.onLyrics((l) => {
    lyrics = l;
    lastLineIndex = -2;
  });
  window.freewave.onArtwork(() => {}); // artwork rides along with track:update

  setInterval(() => {
    if (lyrics && lyrics.synced && lyrics.lines.length) {
      const pos = clock.get() + ((settings.lyrics && settings.lyrics.offset) || 0);
      const { cur, next, index } = window.LyricSync.currentAndNext(lyrics.lines, pos);
      if (index !== lastLineIndex) {
        lastLineIndex = index;
        lCur.textContent = cur || '\u00A0';
        lNext.textContent = next || '';
      }
    } else if (lyrics && lyrics.plain) {
      const linesArr = lyrics.plain.split('\n');
      const dur = clock.duration() || 0;
      const idx = dur > 0 ? Math.floor((clock.get() / dur) * linesArr.length) : 0;
      lCur.textContent = linesArr[Math.min(linesArr.length - 1, Math.max(0, idx))] || '';
      lNext.textContent = linesArr[Math.min(linesArr.length - 1, Math.max(0, idx + 1))] || '';
    } else {
      lCur.innerHTML = '&nbsp;';
      lNext.textContent = '';
    }

    document.body.classList.toggle('audio-dead',
      AudioManager.getMode() !== 'none' ? !AudioManager.hasSignal() && clock.status() === 'Playing' : false);
  }, 200);

  // exit controls
  document.getElementById('exit-btn').addEventListener('click', () => window.freewave.theaterClose());
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.freewave.theaterClose();
  });

  // boot
  applySettings(settings);
  setTimeout(connectAudio, 700);
})();
