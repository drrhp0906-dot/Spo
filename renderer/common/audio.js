'use strict';

/**
 * Freewave audio manager (renderer side).
 *
 * Sources:
 *  - loopback : system audio capture via getDisplayMedia. The main process
 *               auto-grants the request and requests `audio: 'loopback'`,
 *               which on Windows captures whatever Spotify / YouTube / VLC is
 *               playing — no microphone needed.
 *  - mic      : plain getUserMedia microphone capture.
 *  - file     : local audio file via <audio> + MediaElementSource.
 */

const AudioManager = (() => {
  let ctx = null;
  let analyser = null;
  let sourceNode = null;
  let mediaEl = null;
  let mode = 'none';
  let lastError = null;

  const FREQ_BINS = 1024; // fftSize 2048
  const freq = new Uint8Array(FREQ_BINS);
  const time = new Uint8Array(2048);

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function teardownSource() {
    if (mediaEl) {
      try { mediaEl.pause(); } catch {}
      mediaEl = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch {}
      sourceNode = null;
    }
    analyser = null;
  }

  function wire(node) {
    ensureCtx();
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch {}
    }
    sourceNode = node;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8; // overwritten by applySettings
    node.connect(analyser);
  }

  function applySettings(s) {
    if (analyser) {
      const sm = Math.min(0.95, Math.max(0, Number(s.smoothing) || 0.8));
      analyser.smoothingTimeConstant = sm;
    }
  }

  async function useLoopback() {
    teardownSource();
    lastError = null;
    try {
      // Ask for screen + system-audio loopback. The main process auto-grants
      // this request via setDisplayMediaRequestHandler and pins
      // `audio: 'loopback'`, which on Windows captures WASAPI loopback of the
      // default render device — no picker, no shared "screen" source. That is
      // essential here: the wallpaper window lives inside the desktop's own
      // WorkerW layer, so asking Windows to share that screen for capture can
      // fail outright (or return an audio-less stream) on some setups.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never',
          chromeMediaSource: 'desktop',
          mandatory: { chromeMediaSource: 'desktop' }
        },
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: 'loopback'
          }
        }
      });
      // We only need the audio track; drop the video one immediately.
      stream.getVideoTracks().forEach((t) => { try { t.stop(); } catch {} });
      if (!stream.getAudioTracks().length) {
        throw new Error('NO_SYSTEM_AUDIO');
      }
      ensureCtx();
      const src = ctx.createMediaStreamSource(stream);
      wire(src);
      mode = 'loopback';
      return { ok: true, mode };
    } catch (err) {
      lastError = err && err.message === 'NO_SYSTEM_AUDIO'
        ? 'System audio could not be captured'
        : ((err && err.name) === 'NotAllowedError' ? 'Capture was blocked' : String(err && err.message || err));
      mode = 'none';
      throw new Error(lastError);
    }
  }

  async function useMic() {
    teardownSource();
    lastError = null;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    });
    wire(ctx.createMediaStreamSource(stream));
    mode = 'mic';
    return { ok: true, mode };
  }

  async function useFile(fileUrl) {
    teardownSource();
    lastError = null;
    ensureCtx();
    mediaEl = new Audio(fileUrl);
    mediaEl.loop = true;
    mediaEl.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      mediaEl.addEventListener('canplay', resolve, { once: true });
      mediaEl.addEventListener('error', () => reject(new Error('Cannot load audio file')), { once: true });
      mediaEl.load();
    });
    const node = ctx.createMediaElementSource(mediaEl);
    wire(node);
    await mediaEl.play().catch(() => {});
    mode = 'file';
    return { ok: true, mode };
  }

  function fileControls() {
    if (!mediaEl) return null;
    return {
      play: () => mediaEl.play().catch(() => {}),
      pause: () => mediaEl.pause(),
      seek: (t) => { try { mediaEl.currentTime = t; } catch {} },
      position: () => mediaEl.currentTime || 0,
      duration: () => mediaEl.duration || 0,
      paused: () => mediaEl.paused
    };
  }

  /** Pull fresh FFT data. Returns null when no source is connected. */
  function frame() {
    if (!analyser) return null;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(time);
    return { freq, time };
  }

  /** RMS level 0..1, for the Settings diagnostics meter. */
  function level() {
    if (!analyser || mode === 'none') return 0;
    let sum = 0;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / time.length) * 2.2);
  }

  function getMode() { return mode; }
  function getError() { return lastError; }
  function hasSignal() {
    if (!analyser) return false;
    let sum = 0;
    for (let i = 2; i < 220; i++) sum += freq[i];
    return sum > 40; // audible content above noise floor
  }

  return {
    useLoopback, useMic, useFile, fileControls,
    frame, level, applySettings, getMode, getError, hasSignal,
    ctx: () => ctx
  };
})();

window.AudioManager = AudioManager;
