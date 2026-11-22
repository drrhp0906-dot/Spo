'use strict';

/**
 * Freewave canvas engine.
 *
 * Owns: the full-window canvas, the rAF loop, FFT analysis bands, a simple
 * beat detector, and routing of frames to the active visualizer.
 * Visualizers are plain objects { id, name, draw(frame) } registered in
 * visualizers.js — swapping is instant and seamless.
 */

const Engine = (() => {
  let canvas = null;
  let ctx = null;
  let raf = 0;
  let running = false;
  let lastT = 0;
  let visualizer = null;
  let settings = null;

  // smoothed energy bands + beat detection state
  const bands = { bass: 0, mid: 0, treble: 0, level: 0 };
  let bassAvg = 0;
  let lastBeat = 0;
  let beatFlash = 0;

  const binCache = new Map();

  function logBins(count) {
    if (binCache.has(count)) return binCache.get(count);
    const ranges = new Array(count);
    const min = 2;
    const max = 520;
    for (let i = 0; i < count; i++) {
      const a = Math.floor(min * Math.pow(max / min, i / count));
      const b = Math.max(a + 1, Math.floor(min * Math.pow(max / min, (i + 1) / count)));
      ranges[i] = [a, b];
    }
    binCache.set(count, ranges);
    return ranges;
  }

  /** Map spectrum to `count` log-spaced values in 0..1 (sensitivity applied). */
  function spectrum(f, count, sens) {
    const ranges = logBins(count);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const [a, b] = ranges[i];
      let sum = 0;
      for (let k = a; k < b; k++) sum += f.freq[k];
      out[i] = Math.min(1.6, (sum / (b - a) / 255) * sens);
    }
    return out;
  }

  function computeBands(f, sens, dt) {
    const avg = (a, b) => {
      let s = 0;
      for (let i = a; i < b; i++) s += f.freq[i];
      return s / ((b - a) * 255);
    };
    const rawBass = avg(1, 8) * sens;
    const rawMid = avg(8, 80) * sens;
    const rawTreble = avg(80, 400) * sens;
    const rawLevel = avg(1, 400) * sens;

    const k = Math.min(1, dt * 12);
    bands.bass += (rawBass - bands.bass) * k;
    bands.mid += (rawMid - bands.mid) * k;
    bands.treble += (rawTreble - bands.treble) * k;
    bands.level += (rawLevel - bands.level) * k;

    bassAvg = bassAvg * 0.98 + rawBass * 0.02;
    const now = performance.now();
    if (rawBass > bassAvg * 1.30 && rawBass > 0.16 && now - lastBeat > 220) {
      lastBeat = now;
      beatFlash = 1;
    }
    beatFlash = Math.max(0, beatFlash - dt * 3.2);
    return {
      ...bands,
      beat: beatFlash,
      rawBass,
      spectrum: (count) => spectrum(f, count, sens)
    };
  }

  function resize() {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!ctx || !visualizer) return;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const colors = window.FreewaveThemes
      ? window.FreewaveThemes.resolveColors(settings)
      : { bg: '#07000f', primary: '#ff2fd6', secondary: '#2fe9ff', accent: '#ffe14d' };

    // paint background
    ctx.save();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, colors.bg);
    grad.addColorStop(1, shade(colors.bg, -14));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const data = window.AudioManager ? AudioManager.frame() : null;
    const empty = { freq: new Uint8Array(1024), time: new Uint8Array(2048).fill(128) };
    const f = data || empty;

    const sens = Math.min(3, Math.max(0.2, Number(settings && settings.sensitivity) || 1));
    const frame = {
      ctx, w, h, dt, t,
      colors,
      data: f,
      bands: computeBands(f, sens, dt)
    };

    try {
      visualizer.draw(frame, settings || {});
    } catch (err) {
      console.warn('[engine] visualizer draw error:', err);
    }
  }

  function shade(hex, amt) {
    const m = String(hex).replace('#', '');
    const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16);
    const r = Math.min(255, Math.max(0, (n >> 16) + amt));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + amt));
    const b = Math.min(255, Math.max(0, (n & 255) + amt));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function start() {
    if (running) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function init(canvasEl, initialSettings, visRegistry, defaultVisId) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    settings = initialSettings;
    resize();
    window.addEventListener('resize', resize);
    setVisualizer(visRegistry, defaultVisId);
    start();
  }

  function setVisualizer(registry, id) {
    const found = registry.find((v) => v.id === id) || registry[0];
    visualizer = found;
  }

  function applySettings(s) {
    settings = s;
    if (window.AudioManager) AudioManager.applySettings(s);
  }

  return { init, start, stop, setVisualizer, applySettings, shade, spectrum };
})();

window.Engine = Engine;
