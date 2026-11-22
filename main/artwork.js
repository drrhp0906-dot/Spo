'use strict';

/**
 * Album artwork service — uses the free iTunes Search API (no key, no
 * account). Art is downloaded once per track into userData/artcache and
 * referenced by file path, so windows can show it without re-fetching.
 */

const { net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { cleanTrackName } = require('./util');

const USER_AGENT = 'Freewave/1.0 (free desktop music visualizer)';

class ArtworkService {
  constructor(userDataDir) {
    this.cacheDir = path.join(userDataDir, 'artcache');
    try { fs.mkdirSync(this.cacheDir, { recursive: true }); } catch {}
    this.inFlight = new Map();
  }

  _key(artist, title) {
    return crypto.createHash('md5')
      .update(`${artist}|${title}`.toLowerCase())
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * @returns {Promise<string|null>} absolute file path to a jpg/png, or null.
   */
  async get({ title, artist }) {
    const cleanTitle = cleanTrackName(title);
    const cleanArtist = String(artist || '').trim();
    if (!cleanTitle && !cleanArtist) return null;

    const key = this._key(cleanArtist, cleanTitle);
    const file = path.join(this.cacheDir, key + '.jpg');
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;

    if (this.inFlight.has(key)) return this.inFlight.get(key);

    const p = this._download(cleanArtist, cleanTitle, file)
      .then((result) => {
        this.inFlight.delete(key);
        return result;
      })
      .catch((err) => {
        console.warn('[artwork] failed:', err.message);
        this.inFlight.delete(key);
        return null;
      });

    this.inFlight.set(key, p);
    return p;
  }

  async _download(artist, title, destFile) {
    const term = `${artist} ${title}`.trim();
    const url = 'https://itunes.apple.com/search?limit=1&media=music&entity=song&term=' +
      encodeURIComponent(term);

    const res = await net.fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const results = data && Array.isArray(data.results) ? data.results : [];
    if (!results.length) return null;

    let art = results[0].artworkUrl100 || '';
    if (!art) return null;
    // Upscale iTunes artwork: 100x100bb -> 600x600bb is served for free.
    art = art.replace('100x100bb', '600x600bb');

    const imgRes = await net.fetch(art, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });
    if (!imgRes.ok) throw new Error('art HTTP ' + imgRes.status);

    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length < 1000) return null;
    fs.writeFileSync(destFile, buf);
    return destFile;
  }
}

module.exports = { ArtworkService };
