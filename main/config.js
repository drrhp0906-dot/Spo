'use strict';

const fs = require('fs');
const path = require('path');
const { deepMerge } = require('./util');

const DEFAULTS = {
  visualizer: 'bars',
  theme: 'neonPulse',
  customColors: null, // { bg, primary, secondary, accent } overrides theme when set
  sensitivity: 1.0,
  smoothing: 0.8,

  wallpaperMode: true,

  clock: {
    enabled: true,
    style: 'digital', // digital | analog | minimal | words
    corner: 'top-right',
    format24: false,
    showSeconds: true
  },

  nowPlaying: {
    enabled: true,
    layout: 'card', // card | minimal
    corner: 'bottom-left',
    showLyricLine: true
  },

  lyrics: {
    overlay: true,
    fontSize: 34,
    offset: 0, // seconds, applied to lyric timestamps
    position: 'bottom' // visual position hint for overlay window placement
  },

  audio: {
    source: 'loopback', // loopback | mic | file
    file: null
  },

  general: {
    autostart: false,
    theaterShortcut: 'Control+Alt+F',
    lyricsShortcut: 'Control+Alt+L'
  }
};

class Config {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'config.json');
    this.data = DEFAULTS;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = deepMerge(DEFAULTS, raw);
      }
    } catch (err) {
      console.warn('[config] failed to load, using defaults:', err.message);
      this.data = deepMerge({}, DEFAULTS);
    }
    return this.data;
  }

  all() {
    return this.data;
  }

  /** Save a partial patch (deep-merged) and return the full new config. */
  save(patch) {
    this.data = deepMerge(this.data, patch || {});
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('[config] failed to save:', err.message);
    }
    return this.data;
  }
}

module.exports = { Config, DEFAULTS };
