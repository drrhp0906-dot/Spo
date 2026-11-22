'use strict';

/**
 * Lyrics service — powered by LRCLIB (https://lrclib.net), a free and open
 * lyrics database that requires no API key. Fetches synced (LRC) lyrics when
 * available and falls back to plain lyrics. Results are cached in memory and
 * on disk so tracks re-resolve instantly and work offline after first fetch.
 */

const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const { parseLRC } = require('./lrc-parser');
const { cleanTrackName } = require('./util');

const USER_AGENT = 'Freewave/1.0 (free desktop music visualizer; https://github.com/freewave-desktop/freewave)';

class LyricsService {
  constructor(userDataDir) {
    this.cacheDir = path.join(userDataDir, 'lyrics-cache');
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch {}
    this.mem = new Map(); // key -> { synced, lines, plain }
    this.inFlight = new Map();
  }

  _cacheFile(key) {
    const safe = key.replace(/[^a-z0-9]+/gi, '_').slice(0, 120).toLowerCase();
    return path.join(this.cacheDir, safe + '.json');
  }

  _readCache(key) {
    if (this.mem.has(key)) return this.mem.get(key);
    try {
      const file = this._cacheFile(key);
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.mem.set(key, data);
        return data;
      }
    } catch {}
    return null;
  }

  _writeCache(key, data) {
    this.mem.set(key, data);
    try {
      fs.writeFileSync(this._cacheFile(key), JSON.stringify(data), 'utf8');
    } catch {}
  }

  async _fetchJson(url) {
    const res = await net.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }

  /**
   * Resolve lyrics for a track.
   * @returns {Promise<{synced: boolean, lines: Array<{time:number,text:string}>, plain: string, source: string}|null>}
   */
  async get({ title, artist, album, duration }) {
    const cleanTitle = cleanTrackName(title);
    const cleanArtist = String(artist || '').trim();
    if (!cleanTitle) return null;

    const key = `${cleanArtist}|${cleanTitle}`.toLowerCase();

    const cached = this._readCache(key);
    if (cached) return cached;

    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const p = this._resolve({ title: cleanTitle, artist: cleanArtist, album, duration })
      .then((data) => {
        if (data) this._writeCache(key, data);
        this.inFlight.delete(key);
        return data;
      })
      .catch((err) => {
        console.warn('[lyrics] resolve failed:', err.message);
        this.inFlight.delete(key);
        return null;
      });

    this.inFlight.set(key, p);
    return p;
  }

  async _resolve({ title, artist, album, duration }) {
    const dur = Math.round(Number(duration) || 0);
    const enc = encodeURIComponent;

    // 1) Exact lookup with duration hint (best quality match on LRCLIB).
    const url1 =
      `https://lrclib.net/api/get?artist_name=${enc(artist)}` +
      `&track_name=${enc(title)}` +
      (album ? `&album_name=${enc(album)}` : '') +
      (dur > 0 ? `&duration=${dur}` : '');

    try {
      const data = await this._fetchJson(url1);
      const result = this._fromLrclibRecord(data);
      if (result) return result;
    } catch {}

    // 2) Free-text search, take the closest by duration then the first result.
    try {
      const q = `${artist} ${title}`.trim();
      const list = await this._fetchJson(`https://lrclib.net/api/search?q=${enc(q)}`);
      if (Array.isArray(list) && list.length) {
        let best = list[0];
        if (dur > 0) {
          let bestDiff = Infinity;
          for (const rec of list) {
            const d = Math.abs((Number(rec.duration) || 0) - dur);
            if (rec.syncedLyrics && d < bestDiff) { bestDiff = d; best = rec; }
          }
        }
        const result = this._fromLrclibRecord(best);
        if (result) return result;
      }
    } catch {}

    // 3) Artist-only search as a last resort.
    if (artist) {
      try {
        const list = await this._fetchJson(
          `https://lrclib.net/api/search?artist_name=${enc(artist)}&track_name=${enc(title)}`
        );
        if (Array.isArray(list) && list.length) {
          const result = this._fromLrclibRecord(list[0]);
          if (result) return result;
        }
      } catch {}
    }

    return null;
  }

  _fromLrclibRecord(rec) {
    if (!rec) return null;
    const syncedText = rec.syncedLyrics || '';
    const plainText = rec.plainLyrics || '';
    if (syncedText) {
      const lines = parseLRC(syncedText);
      if (lines.length) {
        return { synced: true, lines, plain: plainText || '', source: 'LRCLIB' };
      }
    }
    if (plainText) {
      return { synced: false, lines: [], plain: plainText, source: 'LRCLIB' };
    }
    return null;
  }
}

module.exports = { LyricsService };
