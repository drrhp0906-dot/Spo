'use strict';

/**
 * Node-side bridge to scripts/smtc.ps1.
 *
 * Spawns one long-lived PowerShell process that polls Windows System Media
 * Transport Controls (SMTC) and emits JSON lines. This is how Freewave knows
 * what Spotify / YouTube / VLC is playing — the same mechanism Weyv uses.
 *
 * Events: 'track' ({title, artist, album, status, duration}),
 *         'position' ({position, age, rate, status, duration}),
 *         'idle', 'fatal', 'ready'.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

class SmtcPoller extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.buffer = '';
    this.running = false;
    this.smtcAvailable = true;
    this.fatalOnce = false;
  }

  /**
   * Copy the .ps1 out of the app bundle (asar-safe) to userData — normalized
   * for Windows: CRLF line endings, UTF-8 BOM and an executable bit. When a
   * repo was cloned/copied on a Linux filesystem (WSL, shared folders), the
   * bundled script has LF endings and no exec bit, and powershell.exe refuses
   * to run it ("cannot execute the file ... not digitally signed" / garbage
   * parse errors). That is why SMTC now-playing silently stopped working on
   * such installs; re-writing the copy here repairs it at every launch.
   */
  materializeScript(userDataDir) {
    const src = path.join(__dirname, '..', 'scripts', 'smtc.ps1');
    const dst = path.join(userDataDir, 'smtc.ps1');
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
    } catch {}
    try {
      let text = fs.readFileSync(src, 'utf8');
      text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
      if (!text.startsWith('\uFEFF')) text = '\uFEFF' + text;
      fs.writeFileSync(dst, text, 'utf8');
      try { fs.chmodSync(dst, 0o700); } catch {}
      return dst;
    } catch (err) {
      console.error('[smtc] cannot materialize smtc.ps1:', err.message);
      try {
        // Last resort: normalize into the temp dir instead of userData.
        const tmp = path.join(require('os').tmpdir(), 'freewave-smtc.ps1');
        let text = fs.readFileSync(src, 'utf8');
        text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
        if (!text.startsWith('\uFEFF')) text = '\uFEFF' + text;
        fs.writeFileSync(tmp, text, 'utf8');
        try { fs.chmodSync(tmp, 0o700); } catch {}
        return tmp;
      } catch {
        return src; // works in dev (non-asar) if the file itself is runnable
      }
    }
  }

  start(userDataDir) {
    if (process.platform !== 'win32') {
      this.smtcAvailable = false;
      this.emit('fatal', { message: 'not-windows' });
      return;
    }
    if (this.running) return;
    this.running = true;

    const script = this.materializeScript(userDataDir);
    try {
      this.child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      );
    } catch (err) {
      console.error('[smtc] spawn failed:', err.message);
      this.smtcAvailable = false;
      this.running = false;
      this.emit('fatal', { message: 'spawn-failed' });
      return;
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      // PowerShell writes benign startup noise here; only log real problems.
      if (chunk && chunk.trim()) console.warn('[smtc:ps-stderr]', chunk.trim().slice(0, 300));
    });
    this.child.on('exit', (code) => {
      this.running = false;
      this.child = null;
      if (this.stopping) return;
      console.warn('[smtc] poller exited (code ' + code + ')');
      if (!this.smtcAvailable) {
        this.emit('fatal', { message: 'smtc-unavailable' });
      } else {
        // Give the machine a moment, then retry once — e.g. after wake-from-sleep.
        setTimeout(() => {
          if (!this.stopping) this.start(userDataDir);
        }, 5000);
      }
    });
  }

  _onData(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      switch (msg.event) {
        case 'ready':
          this.smtcAvailable = true;
          this.emit('ready');
          break;
        case 'track':
          this.smtcAvailable = true;
          this.emit('track', {
            title: msg.title || '',
            artist: msg.artist || '',
            album: msg.album || '',
            status: msg.status || 'Stopped',
            duration: Number(msg.duration) || 0,
            source: 'smtc'
          });
          break;
        case 'position':
          this.emit('position', {
            position: Number(msg.position) || 0,
            age: Number(msg.age) || 0,
            rate: Number(msg.rate) || 1,
            status: msg.status || 'Stopped',
            duration: Number(msg.duration) || 0
          });
          break;
        case 'idle':
          this.emit('idle');
          break;
        case 'fatal':
          this.smtcAvailable = false;
          this.emit('fatal', msg);
          break;
        default:
          break;
      }
    }
  }

  /** Play/pause the active media session (used by the tray menu). */
  togglePlayback(userDataDir) {
    if (process.platform !== 'win32') return;
    const script = this.materializeScript(userDataDir);
    try {
      const c = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'toggle'
      ], { stdio: 'ignore', windowsHide: true });
      c.on('error', (err) => console.error('[smtc] toggle failed:', err.message));
    } catch (err) {
      console.error('[smtc] toggle spawn failed:', err.message);
    }
  }

  stop() {
    this.stopping = true;
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
    this.running = false;
  }
}

module.exports = { SmtcPoller };
