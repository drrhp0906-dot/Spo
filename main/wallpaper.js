'use strict';

/**
 * Wallpaper attachment for Windows — the classic "Progman / WorkerW" trick.
 *
 * We broadcast message 0x052C to Progman, which makes Windows spawn an extra
 * WorkerW window behind the desktop-icons layer. We then reparent our
 * Electron window to that WorkerW, so the visualizer literally becomes your
 * wallpaper while icons stay visible and clickable on top.
 *
 * Two independent attach paths:
 *   1. koffi (prebuilt N-API FFI) calling user32 directly — preferred.
 *   2. scripts/attach.ps1 via powershell.exe — automatic fallback when koffi
 *      cannot load (missing prebuilt binary, antivirus quarantine, ...).
 *
 * v1.0.1: koffi callback prototypes (koffi.proto) were removed on purpose.
 * A bare proto is not a valid parameter type in koffi 2.x ("Type X cannot be
 * used as a parameter"), and protos register process-global names that blow
 * up on re-init ("Duplicate type name") — Freewave re-runs attach at startup
 * and on wallpaper-mode toggles. Window enumeration is now done with plain
 * FindWindowExW z-order loops (see workerw-find.js), which need no callbacks
 * and no global type registrations at all.
 */

const { app, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { asBigInt, nonzero, pickWorkerw } = require('./workerw-find');

let fns = null; // user32 bindings via koffi, cached after a successful init

// ---------------------------------------------------------------------------
// Windows-only guard.
//
// Freewave targets Windows: the WorkerW wallpaper trick, the SMTC poller and
// the system-audio loopback all need win32. Historically this app "didn't run
// properly" when its files were carried over from a Linux/macOS machine (git
// clones on WSL, shared folders, ...): every .ps1 helper then has LF line
// endings and the *executable bit missing*. PowerShell 5.1 (powershell.exe)
// tolerates neither — it refuses to run a script without the execute bit —
// so both attach paths silently failed and the visualizer never appeared.
// normalizeScripts() repairs both problems at startup.
// ---------------------------------------------------------------------------

/** Convert LF-only content to CRLF (what powershell.exe expects on Windows). */
function toCrlf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

/**
 * Read a bundled PowerShell script, normalize it to CRLF + UTF-8 BOM (the BOM
 * makes Windows PowerShell 5.1 read UTF-8 non-ASCII characters correctly),
 * and write it to `dst` with the owner-execute bit set. Returns `dst`.
 */
function writeNormalizedScript(srcPath, dstPath) {
  let text = fs.readFileSync(srcPath, 'utf8');
  text = toCrlf(text);
  if (!text.startsWith('\uFEFF')) text = '\uFEFF' + text;
  fs.writeFileSync(dstPath, text, 'utf8');
  try {
    // Restore the executable bit that is lost when these files are created or
    // copied on non-Windows filesystems (WSL mounts, network shares, zip...).
    fs.chmodSync(dstPath, 0o700);
  } catch {}
  return dstPath;
}

/**
 * Ensure scripts/<name>.ps1 exists in normalized form next to the bundle and
 * return its path. Used as a last-resort fallback location when copying into
 * userData fails (e.g. read-only install dir combined with locked profile).
 */
function normalizeBundledScript(name) {
  const src = path.join(__dirname, '..', 'scripts', name);
  const dst = path.join(os.tmpdir(), 'freewave-' + name);
  try {
    return writeNormalizedScript(src, dst);
  } catch (err) {
    console.error('[wallpaper] cannot normalize ' + name + ':', err.message);
    return src; // best-effort: run the original anyway
  }
}

/**
 * Bind user32 through koffi. Idempotent and side-effect free: only plain
 * integer/string parameter types are declared, so nothing is registered in
 * koffi's process-global type registry and init() can safely run again
 * after a failure.
 */
function init() {
  if (process.platform !== 'win32') return false;
  if (fns) return true;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    // __stdcall: correct convention for user32 on win32; on x64 it maps to
    // the single standard calling convention, so this is safe everywhere.
    const def = (name, ret, args) => lib.func('__stdcall', name, ret, args);
    fns = {
      FindWindowW: def('FindWindowW', 'int64', ['str16', 'str16']),
      FindWindowExW: def('FindWindowExW', 'int64', ['int64', 'int64', 'str16', 'str16']),
      SendMessageTimeoutW: def('SendMessageTimeoutW', 'int64',
        ['int64', 'uint32', 'int64', 'int64', 'uint32', 'uint32', 'void *']),
      SetParent: def('SetParent', 'int64', ['int64', 'int64']),
      GetParent: def('GetParent', 'int64', ['int64']),
      // POINT is passed as a raw 8-byte buffer to avoid a named koffi struct.
      MapWindowPoints: def('MapWindowPoints', 'int32', ['int64', 'int64', 'void *', 'int32']),
      GetWindowLongPtrW: def('GetWindowLongPtrW', 'int64', ['int64', 'int32']),
      SetWindowLongPtrW: def('SetWindowLongPtrW', 'int64', ['int64', 'int32', 'int64']),
      SetWindowPos: def('SetWindowPos', 'int32',
        ['int64', 'int64', 'int32', 'int32', 'int32', 'int32', 'uint32']),
      ShowWindow: def('ShowWindow', 'int32', ['int64', 'int32'])
    };
    return true;
  } catch (err) {
    console.error('[wallpaper] koffi init failed:', err.message);
    fns = null;
    return false;
  }
}

function getHwnd(win) {
  return asBigInt(win.getNativeWindowHandle().readBigInt64LE(0));
}

/**
 * Map a point from screen coordinates into `toHwnd` client coordinates.
 * `buf` is an 8-byte buffer holding two int32 (x, y), updated in place.
 */
function mapPointInto(toHwnd, buf) {
  fns.MapWindowPoints(0n, toHwnd, buf, 1);
  return { x: buf.readInt32LE(0), y: buf.readInt32LE(4) };
}

/** Restore a window to normal top-level behavior (koffi path). */
function detachNative(hwnd) {
  const GWL_STYLE = -16;
  const WS_CHILD = 0x40000000n;
  const WS_POPUP = 0x80000000n;
  const WS_VISIBLE = 0x10000000n;

  let style = asBigInt(fns.GetWindowLongPtrW(hwnd, GWL_STYLE)) & 0xFFFFFFFFn;
  style = (style & ~WS_CHILD) | WS_POPUP | WS_VISIBLE;
  fns.SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt.asIntN(64, style));
  fns.SetParent(hwnd, 0n);
  return { ok: true };
}

/** Parent the window to the desktop WorkerW (koffi path). */
function attachNative(hwnd, bounds) {
  const progman = asBigInt(fns.FindWindowW('Progman', null));
  if (!nonzero(progman)) return { ok: false, reason: 'Progman not found' };

  // 0x052C asks the shell to spawn the extra WorkerW layer. Idempotent.
  // SMTO_ABORTIFHUNG (0x0002) so a wedged explorer cannot freeze us.
  fns.SendMessageTimeoutW(progman, 0x052C, 0, 0, 0x0002, 1000, null);

  const workerw = pickWorkerw(
    (after, cls) => fns.FindWindowExW(0n, asBigInt(after), cls, null),
    (parent, cls) => fns.FindWindowExW(asBigInt(parent), 0n, cls, null),
    progman
  );
  if (!nonzero(workerw)) return { ok: false, reason: 'WorkerW not found' };

  // Turn the Electron window into a child window.
  const GWL_STYLE = -16;
  const WS_CHILD = 0x40000000n;
  const WS_VISIBLE = 0x10000000n;
  const WS_POPUP = 0x80000000n;
  const WS_OVERLAPPEDGROUP = 0x00CF0000n; // caption + frame + sysmenu + min/max

  let style = asBigInt(fns.GetWindowLongPtrW(hwnd, GWL_STYLE)) & 0xFFFFFFFFn;
  style = (style & ~WS_POPUP & ~WS_OVERLAPPEDGROUP) | WS_CHILD | WS_VISIBLE;
  fns.SetWindowLongPtrW(hwnd, GWL_STYLE, BigInt.asIntN(64, style));

  fns.SetParent(hwnd, workerw);
  // SetParent's return value is unreliable for previously top-level windows,
  // so verify the new parent explicitly.
  const actualParent = asBigInt(fns.GetParent(hwnd));
  if (actualParent !== workerw) return { ok: false, reason: 'SetParent failed' };

  // Position inside the WorkerW's client area: map the primary monitor's
  // top-left corner from screen coords into parent coords (handles multi-
  // monitor rigs where the WorkerW origin is not (0,0)).
  const off = mapPointInto(workerw, Buffer.alloc(8));
  // SWP_NOZORDER (0x4) | SWP_SHOWWINDOW (0x40)
  fns.SetWindowPos(hwnd, 0n, off.x, off.y, bounds.width | 0, bounds.height | 0, 0x0044);
  fns.ShowWindow(hwnd, 5); // SW_SHOW

  return { ok: true };
}

// ------------------------------------------------------- PowerShell fallback

let psScriptPath = null;

/**
 * Copy attach.ps1 out of the app bundle (asar-safe) into userData so that
 * powershell.exe — a process outside Electron — can read it. Mirrors the
 * pattern used for smtc.ps1. The copy is normalized for Windows: CRLF line
 * endings, UTF-8 BOM and an executable bit (see writeNormalizedScript),
 * because PowerShell 5.1 refuses to run scripts created on Linux filesystems.
 */
function materializeAttachScript() {
  if (psScriptPath && fs.existsSync(psScriptPath)) return psScriptPath;
  const src = path.join(__dirname, '..', 'scripts', 'attach.ps1');
  const dst = path.join(app.getPath('userData'), 'attach.ps1');
  try {
    writeNormalizedScript(src, dst);
    psScriptPath = dst;
  } catch (err) {
    psScriptPath = normalizeBundledScript('attach.ps1');
  }
  return psScriptPath;
}

/**
 * Run scripts/attach.ps1 (`attach` or `detach` mode). Resolves — never
 * throws — so attach()/detach() always return a plain result object.
 */
function runAttachScript(mode, hwnd, bounds) {
  return new Promise((resolve) => {
    let script;
    try {
      script = materializeAttachScript();
    } catch (err) {
      return resolve({ ok: false, reason: 'attach.ps1 unavailable (' + err.message + ')' });
    }
    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, hwnd.toString(), mode,
      String(bounds ? bounds.width : 0), String(bounds ? bounds.height : 0)
    ];
    execFile('powershell.exe', args, { timeout: 20000, windowsHide: true },
      (err, stdout, stderr) => {
        const out = String(stdout || '').trim();
        if (out.startsWith('OK')) return resolve({ ok: true });
        const detail = (out || (err && err.message) || '') + (stderr ? ' ' + stderr : '');
        return resolve({ ok: false, reason: ('powershell: ' + detail).trim().slice(0, 200) });
      });
  });
}

// ------------------------------------------------------------ public API

/** Serialize attach/detach so overlapping calls (startup re-assert, toggles) can't race. */
let opChain = Promise.resolve();
function queued(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.then(() => {}, () => {});
  return run;
}

async function doAttach(win) {
  if (process.platform !== 'win32') return { ok: false, reason: 'not-windows' };
  if (!win || win.isDestroyed()) return { ok: false, reason: 'window destroyed' };

  const bounds = screen.getPrimaryDisplay().bounds;
  try {
    win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  } catch {}

  const hwnd = getHwnd(win);
  if (!nonzero(hwnd)) return { ok: false, reason: 'no native handle' };

  if (init()) {
    try {
      const res = attachNative(hwnd, bounds);
      if (res.ok) return { ok: true, mode: 'koffi' };
      console.warn('[wallpaper] native attach failed:', res.reason, '- falling back to PowerShell');
    } catch (err) {
      console.warn('[wallpaper] native attach threw:', err.message, '- falling back to PowerShell');
    }
  }

  const res = await runAttachScript('attach', hwnd, bounds);
  return res.ok ? { ok: true, mode: 'powershell' } : { ok: false, reason: res.reason };
}

async function doDetach(win) {
  if (process.platform !== 'win32') return { ok: true };
  if (!win || win.isDestroyed()) return { ok: true };

  const hwnd = getHwnd(win);
  let res;
  if (init()) {
    try {
      res = detachNative(hwnd);
    } catch (err) {
      res = await runAttachScript('detach', hwnd, null);
    }
  } else {
    res = await runAttachScript('detach', hwnd, null);
  }

  try {
    if (!win.isDestroyed()) {
      const b = screen.getPrimaryDisplay().bounds;
      win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
  } catch {}
  return res;
}

/** Parent an Electron window to the desktop WorkerW (behind icons). Async. */
function attach(win) {
  return queued(() => doAttach(win));
}

/** Restore a previously attached window to normal top-level behavior. Async. */
function detach(win) {
  return queued(() => doDetach(win));
}

/** Re-fit the attached window after a display resolution change. */
function reposition(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = screen.getPrimaryDisplay().bounds;
    win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
  } catch {}
  if (!fns) return; // PowerShell mode: occasional re-asserts come from attach()
  try {
    const hwnd = getHwnd(win);
    const parent = asBigInt(fns.GetParent(hwnd));
    if (!nonzero(parent)) return;
    const off = mapPointInto(parent, Buffer.alloc(8));
    fns.SetWindowPos(hwnd, 0n, off.x, off.y, screen.getPrimaryDisplay().bounds.width | 0,
      screen.getPrimaryDisplay().bounds.height | 0, 0x0044);
  } catch {}
}

module.exports = { init, attach, detach, reposition };
