'use strict';

/**
 * Lyrics overlay — floats ON TOP of every window (always-on-top, click-through
 * by default). Shows the current karaoke line big and the next line dimmed,
 * synced from Windows playback position + LRC timestamps from LRCLIB.
 *
 * Drag mode is toggled from the tray ("Unlock lyrics") — the overlay then
 * becomes draggable and shows a dashed outline.
 */

(async function () {
  let settings = await window.freewave.getSettings();
  let lyrics = null;
  let track = null;
  const clock = window.LyricSync.makeClock();

  const metaEl = document.getElementById('lyric-meta');
  const curEl = document.getElementById('lyric-current');
  const nextEl = document.getElementById('lyric-next');

  function applyStyle() {
    const size = Math.min(72, Math.max(16, Number(settings.lyrics && settings.lyrics.fontSize) || 34));
    curEl.style.fontSize = size + 'px';
    nextEl.style.fontSize = Math.round(size * 0.58) + 'px';
  }

  function render() {
    const offset = (settings.lyrics && settings.lyrics.offset) || 0;
    const pos = clock.get() + offset;
    const paused = clock.status() !== 'Playing';
    document.body.classList.toggle('paused', paused);

    if (!track || !track.title) {
      metaEl.textContent = '';
      metaEl.classList.add('empty');
      curEl.classList.add('empty');
      nextEl.classList.add('empty');
      curEl.innerHTML = '&nbsp;';
      nextEl.innerHTML = '&nbsp;';
      return;
    }

    if (!lyrics || (!lyrics.synced && !lyrics.plain)) {
      metaEl.textContent = 'Freewave lyrics';
      metaEl.classList.remove('empty');
      curEl.classList.remove('empty');
      nextEl.classList.add('empty');
      curEl.textContent = 'No lyrics found for "' + track.title + '"';
      nextEl.innerHTML = '&nbsp;';
      return;
    }

    if (lyrics.synced) {
      const { cur, next } = window.LyricSync.currentAndNext(lyrics.lines, pos);
      metaEl.classList.add('empty');
      metaEl.innerHTML = '&nbsp;';
      curEl.classList.remove('empty');
      curEl.textContent = (cur || '') || '\u00A0'; // musical breath: blank line
      if (next) {
        nextEl.classList.remove('empty');
        nextEl.textContent = next;
      } else {
        nextEl.classList.add('empty');
        nextEl.innerHTML = '&nbsp;';
      }
    } else {
      // plain (unsynced) lyrics: scroll slowly by position ratio
      metaEl.classList.add('empty');
      const dur = clock.duration() || 0;
      const idx = dur > 0 ? Math.floor((pos / dur) * lyrics.plain.split('\n').length) : 0;
      const linesArr = lyrics.plain.split('\n');
      curEl.classList.remove('empty');
      curEl.textContent = linesArr[Math.min(linesArr.length - 1, Math.max(0, idx))] || '';
      const n = linesArr[Math.min(linesArr.length - 1, Math.max(0, idx + 1))];
      if (n !== undefined) {
        nextEl.classList.remove('empty');
        nextEl.textContent = n;
      } else {
        nextEl.classList.add('empty');
      }
    }
  }

  window.freewave.onTrack((t) => {
    track = t;
    render();
  });
  window.freewave.onPosition((p) => clock.set(p));
  window.freewave.onLyrics((l) => {
    lyrics = l;
    render();
  });
  window.freewave.onSettings((s) => {
    settings = s;
    applyStyle();
  });
  window.freewave.onLyricsLock((unlocked) => {
    document.body.classList.toggle('unlocked', !!unlocked);
    document.body.classList.toggle('locked', !unlocked);
    if (unlocked) {
      curEl.textContent = 'Drag me anywhere, then pick "Unlock lyrics (drag)" again to lock';
    }
  });

  applyStyle();
  setInterval(render, 120);
  render();
})();
