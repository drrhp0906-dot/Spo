'use strict';

/**
 * Settings window logic: binds every control to the config, saves patches
 * (deep-merged in main) and renders live diagnostics from the wallpaper
 * renderer's audio meter.
 */

(async function () {
  let cfg = await window.freewave.getSettings();
  const visIds = [
    ['bars', 'Bars', false], ['mirror', 'Mirror', false], ['ring', 'Ring', false],
    ['blocks', 'Blocks', false], ['waveform', 'Waveform', false], ['aurora', 'Aurora', false],
    ['orb', 'Orb', true], ['particles', 'Particles', true],
    ['terrain', 'Terrain', true], ['waterfall', 'Waterfall', true]
  ];
  const PRO_NOTE = 'pro in weyv - free here';

  // ------------------------------------------------------------- tabs
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // ------------------------------------------------------------- save helper
  let saveTimer = null;
  function save(patch) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      window.freewave.saveSettings(patch).then((next) => { cfg = next; });
    }, 120);
  }

  // ------------------------------------------------------------- visualizer tab
  const visGrid = document.getElementById('vis-grid');
  visIds.forEach(([id, name, wasPro]) => {
    const b = document.createElement('button');
    b.className = 'vis-btn' + (wasPro ? ' pro-badge' : '');
    b.dataset.id = id;
    b.innerHTML = `${name}<span class="free-tag">${wasPro ? PRO_NOTE : 'free'}</span>`;
    b.addEventListener('click', () => {
      save({ visualizer: id });
      visGrid.querySelectorAll('.vis-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    visGrid.appendChild(b);
  });

  const sens = document.getElementById('sens');
  const smooth = document.getElementById('smooth');
  sens.addEventListener('input', () => {
    document.getElementById('sens-val').textContent = Number(sens.value).toFixed(1);
    save({ sensitivity: Number(sens.value) });
  });
  smooth.addEventListener('input', () => {
    document.getElementById('smooth-val').textContent = Number(smooth.value).toFixed(2);
    save({ smoothing: Number(smooth.value) });
  });

  // ------------------------------------------------------------- theme tab
  const themeGrid = document.getElementById('theme-grid');
  window.FreewaveThemes.THEMES.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'theme-card';
    card.dataset.id = t.id;
    card.innerHTML =
      `<div class="theme-swatch" style="--sw0:${t.colors.bg};--sw1:${t.colors.primary};--sw2:${t.colors.secondary};--sw3:${t.colors.accent}"></div>` +
      `<div class="theme-name">${t.name}</div>`;
    card.addEventListener('click', () => {
      save({ theme: t.id, customColors: null });
      syncThemeTab();
    });
    themeGrid.appendChild(card);
  });

  const colorInputs = {
    primary: document.getElementById('c-primary'),
    secondary: document.getElementById('c-secondary'),
    accent: document.getElementById('c-accent'),
    bg: document.getElementById('c-bg')
  };
  Object.entries(colorInputs).forEach(([key, input]) => {
    input.addEventListener('input', () => {
      const custom = { ...(cfg.customColors || {}) };
      custom[key] = input.value;
      save({ customColors: custom });
      syncThemeTab();
    });
  });
  document.getElementById('reset-colors').addEventListener('click', () => {
    save({ customColors: null });
    syncThemeTab();
  });

  function syncThemeTab() {
    themeGrid.querySelectorAll('.theme-card').forEach((c) => {
      c.classList.toggle('active', c.dataset.id === cfg.theme);
    });
    const palette = window.FreewaveThemes.resolveColors(cfg);
    colorInputs.primary.value = palette.primary;
    colorInputs.secondary.value = palette.secondary;
    colorInputs.accent.value = palette.accent;
    colorInputs.bg.value = palette.bg;
  }

  // ------------------------------------------------------------- overlays tab
  bindSwitch('clock-enabled', ['clock', 'enabled']);
  bindSelect('clock-style', ['clock', 'style']);
  bindSelect('clock-corner', ['clock', 'corner']);
  bindSwitch('clock-24h', ['clock', 'format24']);
  bindSwitch('clock-seconds', ['clock', 'showSeconds']);

  bindSwitch('card-enabled', ['nowPlaying', 'enabled']);
  bindSelect('card-layout', ['nowPlaying', 'layout']);
  bindSelect('card-corner', ['nowPlaying', 'corner']);
  bindSwitch('card-lyric', ['nowPlaying', 'showLyricLine']);

  bindSwitch('lyr-overlay', ['lyrics', 'overlay']);
  bindSelect('lyr-position', ['lyrics', 'position']);
  const lyrSize = document.getElementById('lyr-size');
  lyrSize.addEventListener('input', () => {
    document.getElementById('lyr-size-val').textContent = lyrSize.value;
    save({ lyrics: { fontSize: Number(lyrSize.value) } });
  });
  const lyrOffset = document.getElementById('lyr-offset');
  lyrOffset.addEventListener('input', () => {
    document.getElementById('lyr-offset-val').textContent = Number(lyrOffset.value).toFixed(1) + 's';
    save({ lyrics: { offset: Number(lyrOffset.value) } });
  });

  // ------------------------------------------------------------- audio tab
  const radioCards = document.querySelectorAll('.radio-card');
  radioCards.forEach((card) => {
    card.addEventListener('click', () => {
      const v = card.dataset.audio;
      save({ audio: { source: v } });
      cfg = { ...cfg, audio: { ...(cfg.audio || {}), source: v } };
      syncAudioTab();
    });
  });

  document.getElementById('pick-file').addEventListener('click', async () => {
    const file = await window.freewave.chooseAudioFile();
    if (file) {
      save({ audio: { source: 'file', file } });
      cfg = { ...cfg, audio: { ...(cfg.audio || {}), source: 'file', file } };
      syncAudioTab();
    }
  });

  document.getElementById('reconnect').addEventListener('click', () => {
    window.freewave.saveSettings({ __retry: Date.now() });
  });

  document.getElementById('toggle-playback').addEventListener('click', () => {
    window.freewave.togglePlayback();
  });

  function syncAudioTab() {
    const src = (cfg.audio && cfg.audio.source) || 'loopback';
    radioCards.forEach((c) => c.classList.toggle('selected', c.dataset.audio === src));
    document.getElementById('file-name').textContent =
      cfg.audio && cfg.audio.file ? cfg.audio.file.split(/[\\/]/).pop() : 'No file chosen';
  }

  const meterFill = document.getElementById('meter-fill');
  const audioModeEl = document.getElementById('audio-mode');
  const audioSignalEl = document.getElementById('audio-signal');
  window.freewave.onAudioLevel((p) => {
    if (!p) return;
    meterFill.style.width = Math.round(Math.min(1, p.level) * 100) + '%';
    audioModeEl.textContent = p.mode === 'none'
      ? 'not connected' : 'connected: ' + p.mode;
    audioSignalEl.textContent = p.mode === 'none' ? '' : (p.signal ? 'signal detected' : 'no signal yet');
    audioSignalEl.style.color = p.signal ? 'var(--yellow)' : 'var(--ink-dim)';
  });

  // ------------------------------------------------------------- general tab
  bindSwitch('wallpaper-mode', 'wallpaperMode');
  bindSwitch('autostart', ['general', 'autostart']);

  document.getElementById('open-theater').addEventListener('click', () => window.freewave.theaterToggle());
  document.getElementById('quit-btn').addEventListener('click', () => window.freewave.quitApp());
  document.getElementById('win-min').addEventListener('click', () => window.freewave.windowAction('minimize'));
  document.getElementById('win-close').addEventListener('click', () => window.freewave.windowAction('close'));
  document.querySelectorAll('.about a').forEach((a) => {
    a.addEventListener('click', (e) => e.preventDefault());
  });

  // ------------------------------------------------------------- binding helpers
  function getIn(obj, path) {
    return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setIn(obj, path, value) {
    const patch = {};
    let node = patch;
    for (let i = 0; i < path.length - 1; i++) {
      node[path[i]] = {};
      node = node[path[i]];
    }
    node[path[path.length - 1]] = value;
    return patch;
  }

  function bindSwitch(id, path) {
    const p = Array.isArray(path) ? path : [path];
    const el = document.getElementById(id);
    el.addEventListener('change', () => save(setIn({}, p, el.checked)));
  }
  function bindSelect(id, path) {
    const p = Array.isArray(path) ? path : [path];
    const el = document.getElementById(id);
    el.addEventListener('change', () => save(setIn({}, p, el.value)));
  }

  // ------------------------------------------------------------- hydrate
  function hydrate() {
    visGrid.querySelectorAll('.vis-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.id === cfg.visualizer);
    });
    sens.value = cfg.sensitivity;
    smooth.value = cfg.smoothing;
    document.getElementById('sens-val').textContent = Number(cfg.sensitivity).toFixed(1);
    document.getElementById('smooth-val').textContent = Number(cfg.smoothing).toFixed(2);

    syncThemeTab();

    const c = cfg.clock || {};
    document.getElementById('clock-enabled').checked = !!c.enabled;
    document.getElementById('clock-style').value = c.style || 'digital';
    document.getElementById('clock-corner').value = c.corner || 'top-right';
    document.getElementById('clock-24h').checked = !!c.format24;
    document.getElementById('clock-seconds').checked = !!c.showSeconds;

    const np = cfg.nowPlaying || {};
    document.getElementById('card-enabled').checked = !!np.enabled;
    document.getElementById('card-layout').value = np.layout || 'card';
    document.getElementById('card-corner').value = np.corner || 'bottom-left';
    document.getElementById('card-lyric').checked = np.showLyricLine !== false;

    const l = cfg.lyrics || {};
    document.getElementById('lyr-overlay').checked = !!l.overlay;
    document.getElementById('lyr-position').value = l.position || 'bottom';
    lyrSize.value = l.fontSize || 34;
    document.getElementById('lyr-size-val').textContent = String(l.fontSize || 34);
    lyrOffset.value = l.offset || 0;
    document.getElementById('lyr-offset-val').textContent = Number(l.offset || 0).toFixed(1) + 's';

    syncAudioTab();

    document.getElementById('wallpaper-mode').checked = !!cfg.wallpaperMode;
    document.getElementById('autostart').checked = !!(cfg.general && cfg.general.autostart);
  }

  window.freewave.onSettings((next) => {
    cfg = next;
    hydrate();
  });

  hydrate();
})();
