'use strict';

/**
 * Shared lyric timing helpers (renderer side).
 * Lyric lines arrive pre-parsed from the main process:
 *   [{ time: seconds, text: string }, ...] sorted ascending.
 */

window.LyricSync = (() => {
  /** Index of the active line at `position` seconds; -1 if before first. */
  function activeIndex(lines, position) {
    if (!lines || !lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].time <= position) { ans = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return ans;
  }

  /** Current + next line for a position (both null when unavailable). */
  function currentAndNext(lines, position) {
    const i = activeIndex(lines, position);
    const cur = i >= 0 ? lines[i].text : '';
    const next = i >= 0 && i + 1 < lines.length ? lines[i + 1].text : '';
    return { cur, next, index: i };
  }

  /** Smooth interpolated playback position from the main-process anchor. */
  function makeClock() {
    let anchor = { pos: 0, status: 'Stopped', duration: 0, rate: 1, at: Date.now() };
    return {
      set(a) {
        if (a && typeof a.pos === 'number') anchor = a;
      },
      get() {
        const playing = anchor.status === 'Playing';
        return anchor.pos + (playing ? (Date.now() - anchor.at) / 1000 * anchor.rate : 0);
      },
      status() { return anchor.status; },
      duration() { return anchor.duration; }
    };
  }

  return { activeIndex, currentAndNext, makeClock };
})();
