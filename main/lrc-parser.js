'use strict';

/**
 * LRC (synced lyrics) parser — pure functions, unit-testable with plain Node.
 *
 * Supported syntax:
 *   [mm:ss] text
 *   [mm:ss.xx] text
 *   [mm:ss.xxx] text
 *   [00:12.34][01:45.67] repeated line
 *   [offset:+500] global shift in milliseconds
 */

const TIMESTAMP_RE = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_RE = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;

function fractionToSeconds(digits) {
  if (!digits) return 0;
  const d = String(digits);
  if (d.length === 1) return parseInt(d, 10) / 10;
  if (d.length === 2) return parseInt(d, 10) / 100;
  return parseInt(d, 10) / 1000;
}

/**
 * Parse an LRC string into a sorted list of { time, text } entries.
 * Metadata tags ([ar:], [ti:], ...) are ignored. Empty timed lines are kept
 * so the renderer can show a breath between verses.
 */
function parseLRC(text) {
  const out = [];
  if (!text || typeof text !== 'string') return out;

  let offsetSeconds = 0;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const om = raw.match(OFFSET_RE);
    if (om) {
      offsetSeconds = parseInt(om[1], 10) / 1000;
      continue;
    }
    TIMESTAMP_RE.lastIndex = 0;
    const stamps = [];
    let m;
    while ((m = TIMESTAMP_RE.exec(raw)) !== null) {
      const t =
        parseInt(m[1], 10) * 60 +
        parseInt(m[2], 10) +
        fractionToSeconds(m[3]);
      stamps.push(t);
    }
    if (stamps.length === 0) continue;
    const txt = raw.replace(TIMESTAMP_RE, '').trim();
    for (const t of stamps) {
      out.push({ time: t + offsetSeconds, text: txt });
    }
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Find the index of the active line for a given playback position (seconds).
 * Returns -1 before the first line.
 */
function activeLineIndex(lines, position) {
  if (!lines || lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** True when the LRC text contains at least one synced line. */
function isSynced(lrcText) {
  if (!lrcText) return false;
  TIMESTAMP_RE.lastIndex = 0;
  return TIMESTAMP_RE.test(lrcText);
}

module.exports = { parseLRC, activeLineIndex, isSynced };
