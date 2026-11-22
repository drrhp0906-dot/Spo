'use strict';

/**
 * Pure helpers for the Progman/WorkerW wallpaper trick.
 *
 * This module is deliberately free of Electron and koffi imports so it can be
 * unit-tested with a fake window tree (see scripts/test_freewave.js).
 *
 * Background: after broadcasting message 0x052C to Progman, the shell spawns
 * an extra top-level "WorkerW" window that sits BELOW the layer holding the
 * desktop icons (SHELLDLL_DefView). Reparenting a window to that empty
 * WorkerW turns it into the wallpaper while icons stay visible and clickable.
 */

/**
 * Coerce koffi/Windows handle values (Number | BigInt | null) to BigInt.
 * 64-bit HWNDs exceed Number.MAX_SAFE_INTEGER, hence BigInt.
 */
function asBigInt(v) {
  try {
    if (typeof v === 'bigint') return v;
    if (v === null || v === undefined) return 0n;
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/** True when the handle is a real (non-null) window handle. */
function nonzero(v) {
  return asBigInt(v) !== 0n;
}

/**
 * Pick the WorkerW that should host the wallpaper.
 *
 * @param {function(BigInt, string): BigInt} nextTop
 *        Next TOP-LEVEL window of a class after `after` in z-order
 *        (i.e. FindWindowExW(NULL, after, cls, NULL)).
 * @param {function(BigInt, string): BigInt} firstChild
 *        First CHILD window of `parent` with a class
 *        (i.e. FindWindowExW(parent, NULL, cls, NULL)).
 * @param {BigInt} progman Handle of the Progman window.
 * @returns {BigInt} Target WorkerW handle, or 0n when none exists.
 */
function pickWorkerw(nextTop, firstChild, progman) {
  const defviewInProgman = nonzero(firstChild(progman, 'SHELLDLL_DefView'));

  // Walk every top-level WorkerW in z-order (same order EnumWindows uses).
  let first = 0n;   // first WorkerW found (last-resort parent)
  let host = 0n;    // the WorkerW that carries the desktop icon list
  let after = 0n;
  for (let i = 0; i < 64; i++) {
    const w = asBigInt(nextTop(after, 'WorkerW'));
    if (!nonzero(w)) break;
    after = w;
    if (!nonzero(first)) first = w;
    if (!nonzero(host) && nonzero(firstChild(w, 'SHELLDLL_DefView'))) host = w;
  }

  // Standard case after 0x052C: an empty WorkerW directly below the one
  // holding SHELLDLL_DefView — the classic wallpaper parent.
  if (nonzero(host)) {
    const next = asBigInt(nextTop(host, 'WorkerW'));
    if (nonzero(next)) return next;
  }

  // Some shells keep the icon list under Progman itself; then any WorkerW
  // that comes after Progman in z-order is the wallpaper layer.
  if (defviewInProgman) {
    const next = asBigInt(nextTop(progman, 'WorkerW'));
    if (nonzero(next)) return next;
  }

  // Last resort: the first WorkerW we saw (better than failing outright).
  return first;
}

module.exports = { asBigInt, nonzero, pickWorkerw };
