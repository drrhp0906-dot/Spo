'use strict';

/**
 * Wallpaper desktop widgets: clock (digital / analog / minimal / words)
 * and the now-playing card. Pure DOM, driven from app.js state.
 */

const Widgets = (() => {
  const clockEl = document.getElementById('clock');
  const cardEl = document.getElementById('card');
  const artEl = document.getElementById('card-art');
  const artWrap = document.querySelector('.card-art-wrap');
  const statusEl = document.getElementById('card-status');
  const titleEl = document.getElementById('card-title');
  const artistEl = document.getElementById('card-artist');
  const barEl = document.getElementById('card-progress-bar');
  const tCurEl = document.getElementById('card-time-cur');
  const tTotEl = document.getElementById('card-time-total');
  const lyricEl = document.getElementById('card-lyric');
  const hintEl = document.getElementById('audio-hint');
  const hintText = document.getElementById('audio-hint-text');

  let settings = null;
  let track = null;
  let anchor = { pos: 0, status: 'Stopped', duration: 0, rate: 1, at: Date.now() };
  let currentLyric = '';

  let analogCanvas = null;
  let analogCtx = null;
  let clockTickTimer = 0;

  const HOURS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

  function two(n) { return String(n).padStart(2, '0'); }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + two(s);
  }

  function minutesToWords(min) {
    if (min === 0) return "o'clock";
    if (min < 10) return ['oh ' + HOURS[0], 'one', 'two', 'three', 'four', 'five',
      'six', 'seven', 'eight', 'nine'][min];
    if (min === 10) return 'ten';
    if (min === 11) return 'eleven';
    if (min === 12) return 'twelve';
    if (min === 13) return 'thirteen';
    if (min === 14) return 'fourteen';
    if (min === 15) return 'quarter';
    if (min < 20) return ['fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'][min - 15];
    const t = Math.floor(min / 10);
    const r = min % 10;
    return TENS[t] + (r ? '-' + ['one', 'two', 'three', 'four', 'five', 'six',
      'seven', 'eight', 'nine'][r] : '');
  }

  function timeWords(d, use24) {
    let h = d.getHours();
    const m = d.getMinutes();
    let mer = '';
    if (!use24) {
      mer = h < 12 ? 'am' : 'pm';
      h = h % 12;
    }
    const hourWord = use24 ? String(h) : HOURS[h];
    return {
      text: `${hourWord} ${minutesToWords(m)}`,
      mer
    };
  }

  // ------------------------------------------------------------- clock
  function renderClock() {
    if (!settings || !settings.clock) return;
    const c = settings.clock;
    if (!c.enabled) {
      clockEl.classList.add('hidden');
      return;
    }
    clockEl.classList.remove('hidden');
    const cornerClass = 'corner-' + (c.corner || 'top-right');
    if (!clockEl.classList.contains(cornerClass)) {
      clockEl.className = 'widget ' + cornerClass;
    }

    const now = new Date();
    const use24 = !!c.format24;

    if (c.style === 'digital') {
      let h = now.getHours();
      let mer = '';
      if (!use24) { mer = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
      const hh = use24 ? two(h) : String(h);
      const mm = two(now.getMinutes());
      const secs = c.showSeconds ? `<span class="seconds">${two(now.getSeconds())}</span>` : '';
      const ampm = !use24 ? `<span class="meridiem">${mer}</span>` : '';
      clockEl.innerHTML = `<div class="clock-digital">${hh}:${mm}${secs}${ampm}</div>`;
    } else if (c.style === 'minimal') {
      let h = now.getHours();
      let mer = '';
      if (!use24) { mer = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; }
      const hh = use24 ? two(h) : String(h);
      const secs = c.showSeconds ? ':' + two(now.getSeconds()) : '';
      clockEl.innerHTML =
        `<div class="clock-minimal">${hh}:${two(now.getMinutes())}${secs}${use24 ? '' : `<span style="opacity:.5;font-size:24px"> ${mer}</span>`}</div>`;
    } else if (c.style === 'words') {
      const t = timeWords(now, use24);
      clockEl.innerHTML =
        `<div class="clock-words">It's ${t.text}${t.mer ? `<span class="meridiem"> ${t.mer}</span>` : ''}</div>`;
    } else if (c.style === 'analog') {
      if (!clockEl.querySelector('canvas')) {
        clockEl.innerHTML = '<canvas width="150" height="150"></canvas>';
        analogCanvas = clockEl.querySelector('canvas');
        analogCtx = analogCanvas.getContext('2d');
      }
      drawAnalog(now);
    }
  }

  function drawAnalog(d) {
    const ctx = analogCtx;
    const size = 150;
    const c = size / 2;
    const r = c - 6;
    ctx.clearRect(0, 0, size, size);

    // face
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244,236,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ticks
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const x0 = c + Math.cos(a) * (r - 3);
      const y0 = c + Math.sin(a) * (r - 3);
      const x1 = c + Math.cos(a) * (r - (i % 3 === 0 ? 13 : 8));
      const y1 = c + Math.sin(a) * (r - (i % 3 === 0 ? 13 : 8));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,47,214,0.95)' : 'rgba(244,236,255,0.4)';
      ctx.lineWidth = i % 3 === 0 ? 3 : 1.6;
      ctx.stroke();
    }

    const h = d.getHours() % 12 + d.getMinutes() / 60;
    const m = d.getMinutes() + d.getSeconds() / 60;
    const s = d.getSeconds();

    const hand = (angle, len, width, color) => {
      const a = angle * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(c - Math.cos(a) * len * 0.22, c - Math.sin(a) * len * 0.22);
      ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
    };

    hand(h / 12, r * 0.52, 5, '#f4ecff');
    hand(m / 60, r * 0.74, 3.4, '#2fe9ff');
    hand(s / 60, r * 0.8, 1.6, 'rgba(255,47,214,0.9)');

    ctx.beginPath();
    ctx.arc(c, c, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe14d';
    ctx.fill();
  }

  function startClock() {
    clearInterval(clockTickTimer);
    renderClock();
    clockTickTimer = setInterval(renderClock, 1000);
  }

  // ------------------------------------------------------------- now playing card
  function setCorner(el, corner, className) {
    const cls = 'corner-' + corner;
    if (!el.classList.contains(cls)) {
      // keep only widget + corner class (hide state managed separately)
      const hidden = el.classList.contains('hidden');
      el.className = 'widget ' + cls + (hidden ? ' hidden' : '');
      if (className) el.classList.add(className);
    }
  }

  function renderCard() {
    if (!settings || !settings.nowPlaying) return;
    const np = settings.nowPlaying;
    if (!np.enabled) {
      cardEl.classList.add('hidden');
      return;
    }
    cardEl.classList.remove('hidden');
    setCorner(cardEl, np.corner || 'bottom-left');

    const layout = np.layout || 'card';
    if (layout === 'minimal' && !cardEl.classList.contains('layout-minimal')) {
      cardEl.classList.add('layout-minimal');
    } else if (layout !== 'minimal') {
      cardEl.classList.remove('layout-minimal');
    }

    const paused = track && track.status && track.status !== 'Playing';
    statusEl.textContent = paused ? (track.status === 'Paused' ? 'Paused' : track.status) : 'Playing';
    statusEl.className = 'card-status' + (paused ? ' paused' : '');

    titleEl.textContent = (track && track.title) || 'Nothing playing';
    artistEl.textContent = (track && track.artist) || 'Play something in Spotify, YouTube or any player';

    const hasArt = !!track && !!track.artUrl;
    artWrap.classList.toggle('has-art', hasArt);
    if (hasArt) artEl.src = track.artUrl;

    const dur = anchor.duration || (track && track.duration) || 0;
    const pos = interpolatedPosition();
    barEl.style.width = dur > 0 ? Math.min(100, (pos / dur) * 100) + '%' : '0%';
    tCurEl.textContent = fmtTime(pos);
    tTotEl.textContent = fmtTime(dur);
  }

  function interpolatedPosition() {
    const playing = anchor.status === 'Playing';
    return anchor.pos + (playing ? (Date.now() - anchor.at) / 1000 * anchor.rate : 0);
  }

  function renderLyricLine() {
    if (!settings || !settings.nowPlaying || !settings.nowPlaying.showLyricLine) {
      lyricEl.textContent = '';
      return;
    }
    lyricEl.textContent = currentLyric || '';
  }

  // ------------------------------------------------------------- hint
  function showHint(text) {
    hintText.textContent = text;
    hintEl.classList.remove('hidden');
  }
  function hideHint() {
    hintEl.classList.add('hidden');
  }

  // ------------------------------------------------------------- public
  return {
    init(s) {
      settings = s;
      startClock();
      renderCard();
    },
    applySettings(s) {
      settings = s;
      startClock();
      renderCard();
    },
    setTrack(t) {
      track = t;
      renderCard();
    },
    setArtUrl(url) {
      if (track) {
        track = { ...track, artUrl: url };
      } else {
        track = { title: '', artist: '', artUrl: url };
      }
      renderCard();
    },
    setAnchor(a) {
      anchor = a;
      renderCard();
    },
    setLyric(line) {
      currentLyric = line || '';
      renderLyricLine();
    },
    showHint,
    hideHint
  };
})();

window.Widgets = Widgets;
