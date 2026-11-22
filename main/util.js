'use strict';

/**
 * Pure utility helpers (no Electron imports) so they can be unit-tested
 * with plain Node.
 */

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge `patch` into `target` without mutating either.
 * Arrays and non-object values are replaced wholesale.
 */
function deepMerge(target, patch) {
  const out = isPlainObject(target) ? { ...target } : (target === undefined ? {} : target);
  if (!isPlainObject(patch)) return out;
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    if (isPlainObject(pv)) {
      const tv = out[key];
      out[key] = deepMerge(isPlainObject(tv) ? tv : {}, pv);
    } else if (isPlainObject(out) || Array.isArray(out)) {
      out[key] = pv;
    }
  }
  return out;
}

/** Basic in-memory rate limiter helper: returns true at most once per `ms`. */
function makeThrottle(ms) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      return true;
    }
    return false;
  };
}

/** Strip noise from a music title before searching lyrics / artwork. */
function cleanTrackName(title) {
  if (!title) return '';
  let t = String(title);
  t = t.replace(/\s*\((?:[^()]*(?:lyrics?|video|audio|official|visualizer|hd|4k|mv|remaster(?:ed)?|explicit|single|mono|stereo)[^()]*)\)\s*/gi, ' ');
  t = t.replace(/\s*\[(?:[^\[\]]*(?:lyrics?|video|audio|official|hd|4k|mv|remaster(?:ed)?|explicit)[^\[\]]*)\]\s*/gi, ' ');
  t = t.replace(/\s*[-–—]\s*(?:official\s+)?(?:music\s+)?video\s*$/i, '');
  t = t.replace(/\s+feat\.?\s+.*$/i, '');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

/** Parse "Artist - Title.mp3" filenames into metadata. */
function parseFileName(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_/g, ' ');
  const m = base.match(/^\s*(.+?)\s*[-–—]\s*(.+?)\s*$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base.trim() };
}

module.exports = { deepMerge, makeThrottle, cleanTrackName, parseFileName };
