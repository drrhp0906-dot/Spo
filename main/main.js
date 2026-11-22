'use strict';

const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, dialog,
  desktopCapturer, session, screen, nativeImage
} = require('electron');
const path = require('path');
const { Config } = require('./config');
const { SmtcPoller } = require('./smtc');
const { LyricsService } = require('./lyrics');
const { ArtworkService } = require('./artwork');
const wallpaper = require('./wallpaper');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged;
const APP_ROOT = __dirname;

// ---------------------------------------------------------------- app state
let cfg = null;
let poller = null;
let lyricsSvc = null;
let artSvc = null;
let tray = null;
let quitting = false;

let wallpaperWin = null;
let lyricsWin = null;
let theaterWin = null;
let settingsWin = null;
let lyricsUnlocked = false;

const state = {
  track: null,           // {title, artist, album, status, duration, source}
  lyrics: null,          // {synced, lines, plain, source}
  artUrl: null,          // file:// URL of cached artwork
  manualTrack: null,     // metadata for file playback when SMTC is idle
  smtcAvailable: true,
  audio: { mode: 'none', level: 0 },
  anchor: { pos: 0, status: 'Stopped', duration: 0, rate: 1, at: Date.now() }
};

let lastTrackKey = '';
let lyricsKey = '';

// ---------------------------------------------------------------- helpers
function broadcast(channel, payload) {
  for (const w of [wallpaperWin, lyricsWin, theaterWin, settingsWin]) {
    if (w && !w.isDestroyed()) {
      try { w.webContents.send(channel, payload); } catch {}
    }
  }
}

function nowPlayingMeta() {
  if (state.track && state.track.title) return state.track;
  return state.manualTrack;
}

function artUrlFor(p) {
  if (!p) return null;
  try { return pathToFileURL(p).href; } catch { return null; }
}

function broadcastTrack() {
  const t = nowPlayingMeta() || { title: '', artist: '', album: '', status: 'Stopped', duration: 0, source: 'none' };
  broadcast('track:update', {
    ...t,
    artUrl: state.artUrl,
    smtcAvailable: state.smtcAvailable
  });
  updateTrayTooltip(t);
}

function broadcastPosition() {
  broadcast('track:position', {
    pos: state.anchor.pos,
    status: state.anchor.status,
    duration: state.anchor.duration,
    rate: state.anchor.rate,
    at: state.anchor.at
  });
}

// ------------------------------------------------------------- track logic
function onTrackFromSmtc(t) {
  // Ignore sessions without a real title (generic SMTC registrations).
  if (!t.title || !String(t.title).trim()) {
    if (state.track) {
      state.track = null;
      state.artUrl = null;
      state.lyrics = null;
      lastTrackKey = '';
      broadcastTrack();
      broadcast('lyrics:update', null);
    }
    return;
  }

  state.smtcAvailable = true;
  const key = `${t.artist}|${t.title}`.toLowerCase();
  const statusChanged = state.track && state.track.status !== t.status;
  state.track = t;
  state.anchor = {
    pos: 0, status: t.status, duration: t.duration || 0, rate: 1, at: Date.now()
  };

  if (key !== lastTrackKey) {
    lastTrackKey = key;
    state.artUrl = null;
    state.lyrics = null;
    broadcastTrack();
    broadcast('lyrics:update', null);
    resolveExtras(t);
  } else {
    if (statusChanged) broadcastTrack();
  }
  broadcastPosition();
}

function onManualTrack(meta) {
  if (!meta || !meta.title) return;
  state.manualTrack = { ...meta, source: 'file' };
  if (!state.track || !state.track.title) {
    const key = `${meta.artist || ''}|${meta.title}`.toLowerCase();
    state.anchor = { pos: 0, status: 'Playing', duration: meta.duration || 0, rate: 1, at: Date.now() };
    if (key !== lastTrackKey) {
      lastTrackKey = key;
      state.artUrl = null;
      state.lyrics = null;
      broadcastTrack();
      broadcast('lyrics:update', null);
      resolveExtras(meta);
    } else {
      broadcastTrack();
    }
    broadcastPosition();
  }
}

function onSmtcIdle() {
  if (!state.track) return;
  // Media overlay went quiet — clear the SMTC track (file mode re-reports
  // its own metadata through track:manual if the user is playing a file).
  state.track = null;
  state.artUrl = null;
  state.lyrics = null;
  lastTrackKey = '';
  broadcastTrack();
  broadcast('lyrics:update', null);
}

async function resolveExtras(track) {
  const key = `${track.artist}|${track.title}`.toLowerCase();

  // Lyrics (LRCLIB) -----------------------------------------------------
  const lyricsKeyAtStart = key;
  const lyrics = await lyricsSvc.get({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration
  });
  if (lyricsKeyAtStart === lastTrackKey) {
    state.lyrics = lyrics;
    broadcast('lyrics:update', lyrics);
  }

  // Artwork (iTunes) ----------------------------------------------------
  const p = await artSvc.get({ title: track.title, artist: track.artist });
  if (p && lyricsKeyAtStart === lastTrackKey) {
    state.artUrl = artUrlFor(p);
    broadcast('artwork:update', { artUrl: state.artUrl });
    broadcastTrack(); // refresh art in cards
  }
}

// ------------------------------------------------------------- SMTC wiring
function startSmtc() {
  poller = new SmtcPoller();
  poller.on('track', onTrackFromSmtc);
  poller.on('position', (p) => {
    const playing = p.status === 'Playing';
    const pos = playing ? p.position + p.age * p.rate : p.position;
    state.anchor = {
      pos: Math.max(0, pos),
      status: p.status,
      duration: p.duration || state.anchor.duration,
      rate: p.rate || 1,
      at: Date.now()
    };
    broadcastPosition();
  });
  poller.on('idle', onSmtcIdle);
  poller.on('fatal', () => {
    state.smtcAvailable = false;
    broadcastTrack();
  });
  poller.start(app.getPath('userData'));
}

// ------------------------------------------------------------- windows
const preloadPath = path.join(APP_ROOT, 'preload.js');

function createWallpaperWindow() {
  const b = screen.getPrimaryDisplay().bounds;
  wallpaperWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    alwaysOnTop: false,
    backgroundColor: '#07000f',
    show: false,
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  wallpaperWin.setMenu(null);
  wallpaperWin.loadFile(path.join(APP_ROOT, '..', 'renderer', 'wallpaper', 'index.html'));
  wallpaperWin.on('closed', () => { wallpaperWin = null; });
  return wallpaperWin;
}

async function applyWallpaperMode() {
  if (!wallpaperWin || wallpaperWin.isDestroyed()) createWallpaperWindow();
  const win = wallpaperWin;
  if (!cfg.all().wallpaperMode) {
    try { await wallpaper.detach(win); } catch {}
    if (!win.isDestroyed()) win.hide();
    return;
  }
  // attach() is async: it tries koffi first and falls back to a PowerShell
  // helper (scripts/attach.ps1) when koffi is unavailable.
  let res;
  try {
    res = await wallpaper.attach(win);
  } catch (err) {
    res = { ok: false, reason: err && err.message ? err.message : 'attach crashed' };
  }
  if (win.isDestroyed()) return;
  if (res.ok) {
    win.showInactive();
    console.log('[main] visualizer attached behind desktop icons' +
      (res.mode ? ' (via ' + res.mode + ')' : ''));
  } else {
    // Last-resort fallback: frameless fullscreen window (still looks like a wall).
    console.warn('[main] wallpaper attach failed:', res.reason);
    win.setFullScreen(true);
    win.showInactive();
  }
}

function createLyricsWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  lyricsWin = new BrowserWindow({
    x: wa.x + Math.max(0, Math.round((wa.width - 940) / 2)),
    y: cfg.all().lyrics.position === 'top'
      ? wa.y + 24
      : wa.y + wa.height - 210,
    width: 940,
    height: 180,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lyricsWin.setAlwaysOnTop(true, 'screen-saver');
  lyricsWin.setIgnoreMouseEvents(!lyricsUnlocked, { forward: true });
  lyricsWin.setMenu(null);
  lyricsWin.loadFile(path.join(APP_ROOT, '..', 'renderer', 'lyrics', 'index.html'));
  lyricsWin.on('closed', () => { lyricsWin = null; });
  return lyricsWin;
}

function applyLyricsOverlay() {
  if (cfg.all().lyrics.overlay) {
    if (!lyricsWin || lyricsWin.isDestroyed()) createLyricsWindow();
    else lyricsWin.showInactive();
  } else if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.hide();
  }
}

function repositionLyricsWindow() {
  if (!lyricsWin || lyricsWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea;
  lyricsWin.setPosition(
    wa.x + Math.max(0, Math.round((wa.width - 940) / 2)),
    cfg.all().lyrics.position === 'top' ? wa.y + 24 : wa.y + wa.height - 210
  );
}

function toggleLyricsLock() {
  lyricsUnlocked = !lyricsUnlocked;
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    lyricsWin.setIgnoreMouseEvents(!lyricsUnlocked, { forward: true });
    try { lyricsWin.webContents.send('lyrics:lock', lyricsUnlocked); } catch {}
  }
}

function createTheaterWindow() {
  if (theaterWin && !theaterWin.isDestroyed()) {
    theaterWin.focus();
    return theaterWin;
  }
  theaterWin = new BrowserWindow({
    fullscreen: true,
    frame: false,
    backgroundColor: '#05010f',
    show: false,
    webPreferences: {
      preload: preloadPath,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  theaterWin.setMenu(null);
  theaterWin.loadFile(path.join(APP_ROOT, '..', 'renderer', 'theater', 'index.html'));
  theaterWin.once('ready-to-show', () => {
    if (theaterWin && !theaterWin.isDestroyed()) theaterWin.show();
  });
  theaterWin.on('closed', () => { theaterWin = null; });
  return theaterWin;
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 900,
    height: 660,
    minWidth: 780,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0a0614',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(APP_ROOT, '..', 'renderer', 'settings', 'index.html'));
  settingsWin.once('ready-to-show', () => {
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.show();
  });
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

// ------------------------------------------------------------- tray
function trayIconPath() {
  return path.join(APP_ROOT, '..', 'build', 'icon.png');
}

function createTray() {
  const icon = nativeImage.createFromPath(trayIconPath());
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Freewave');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Settings', click: () => createSettingsWindow() },
    { type: 'separator' },
    { label: 'Theater mode', click: () => createTheaterWindow() },
    { label: 'Unlock lyrics (drag)', click: () => toggleLyricsLock() },
    { label: 'Lyrics overlay', type: 'checkbox', checked: cfg.all().lyrics.overlay,
      click: (item) => {
        cfg.save({ lyrics: { overlay: item.checked } });
        broadcast('settings:updated', cfg.all());
        applyLyricsOverlay();
        repositionLyricsWindow();
      } },
    { label: 'Visualizer on desktop', type: 'checkbox', checked: cfg.all().wallpaperMode,
      click: (item) => {
        cfg.save({ wallpaperMode: item.checked });
        broadcast('settings:updated', cfg.all());
        applyWallpaperMode();
      } },
    { type: 'separator' },
    { label: 'Play / Pause', click: () => poller && poller.togglePlayback(app.getPath('userData')) },
    { type: 'separator' },
    { label: 'Quit Freewave', click: () => app.quit() }
  ]));
  tray.on('double-click', () => createSettingsWindow());
}

function updateTrayTooltip(t) {
  if (!tray) return;
  const title = t && t.title ? t.title : 'nothing playing';
  const artist = t && t.artist ? ' — ' + t.artist : '';
  try { tray.setToolTip(`Freewave: ${title}${artist}`); } catch {}
}

// ------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('settings:get', () => cfg.all());

  ipcMain.handle('settings:save', (_e, patch) => {
    let p = patch || {};
    // "__retry" is a control signal (Reconnect audio button), not a setting.
    if (p.__retry !== undefined) {
      delete p.__retry;
      broadcast('audio:retry');
      if (Object.keys(p).length === 0) return cfg.all();
    }
    const before = cfg.all().wallpaperMode;
    const beforeLyrics = { ...cfg.all().lyrics };
    const beforeAudio = cfg.all().audio.source;
    const next = cfg.save(patch);

    if (next.wallpaperMode !== before) applyWallpaperMode();
    if (next.lyrics.overlay !== beforeLyrics.overlay ||
        next.lyrics.position !== beforeLyrics.position) {
      applyLyricsOverlay();
      repositionLyricsWindow();
    }
    if (next.audio.source !== beforeAudio) {
      // wallpaper renderer listens to settings and will reconnect its source
    }
    if (next.general && typeof next.general.autostart === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: next.general.autostart });
    }

    broadcast('settings:updated', next);
    return next;
  });

  ipcMain.handle('state:get', () => ({
    track: nowPlayingMeta(),
    lyrics: state.lyrics,
    artUrl: state.artUrl,
    anchor: { pos: state.anchor.pos, status: state.anchor.status, duration: state.anchor.duration, rate: state.anchor.rate, at: state.anchor.at },
    smtcAvailable: state.smtcAvailable,
    audio: state.audio,
    wallpaperAttached: !!cfg.all().wallpaperMode
  }));

  ipcMain.handle('dialog:audioFile', async () => {
    const res = await dialog.showOpenDialog(settingsWin || undefined, {
      title: 'Choose an audio file',
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'wma'] }
      ]
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('track:manual', (_e, meta) => {
    onManualTrack(meta);
    return true;
  });

  ipcMain.handle('playback:toggle', () => {
    poller && poller.togglePlayback(app.getPath('userData'));
    return true;
  });

  ipcMain.on('audio:level', (_e, payload) => {
    if (payload && typeof payload.level === 'number') state.audio = payload;
    // relay to settings for the live meter
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.send('audio:level', payload);
    }
  });

  ipcMain.handle('theater:toggle', () => {
    if (theaterWin && !theaterWin.isDestroyed()) {
      theaterWin.close();
      return false;
    }
    createTheaterWindow();
    return true;
  });

  ipcMain.handle('theater:close', () => {
    if (theaterWin && !theaterWin.isDestroyed()) theaterWin.close();
    return true;
  });

  ipcMain.handle('settings:open', () => {
    createSettingsWindow();
    return true;
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
    return true;
  });

  ipcMain.handle('window:action', (_e, action) => {
    const w = BrowserWindow.fromWebContents(_e.sender);
    if (!w) return false;
    if (action === 'minimize') w.minimize();
    if (action === 'close') w.close();
    return true;
  });
}

// ------------------------------------------------------------- permissions
function registerSessionHandlers() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ['media', 'fullscreen', 'pointerLock', 'display-capture'];
    cb(allowed.includes(permission));
  });

  // Auto-grant screen capture and, crucially, SYSTEM AUDIO LOOPBACK.
  // This is what lets Freewave visualize Spotify / YouTube / any player
  // without a microphone. Loopback audio is supported on Windows.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) {
        callback({});
        return;
      }
      const primary = screen.getPrimaryDisplay();
      const src = sources.find((s) => s.display_id === String(primary.id)) || sources[0];
      try {
        callback({ source: src, audio: 'loopback' });
      } catch {
        callback({ source: src });
      }
    }).catch(() => callback({}));
  });
}

function registerShortcuts() {
  try { globalShortcut.unregisterAll(); } catch {}
  const g = cfg.all().general || {};
  if (g.theaterShortcut) {
    try {
      globalShortcut.register(g.theaterShortcut, () => {
        if (theaterWin && !theaterWin.isDestroyed()) theaterWin.close();
        else createTheaterWindow();
      });
    } catch {}
  }
  if (g.lyricsShortcut) {
    try {
      globalShortcut.register(g.lyricsShortcut, () => {
        const next = !cfg.all().lyrics.overlay;
        cfg.save({ lyrics: { overlay: next } });
        broadcast('settings:updated', cfg.all());
        applyLyricsOverlay();
        repositionLyricsWindow();
      });
    } catch {}
  }
}

// ------------------------------------------------------------- lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    createSettingsWindow();
  });

  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

  app.whenReady().then(() => {
    cfg = new Config(app.getPath('userData'));
    lyricsSvc = new LyricsService(app.getPath('userData'));
    artSvc = new ArtworkService(app.getPath('userData'));

    app.setLoginItemSettings({ openAtLogin: !!cfg.all().general.autostart });

    registerSessionHandlers();
    registerIpc();

    createWallpaperWindow();
    applyWallpaperMode();
    applyLyricsOverlay();
    createTray();
    startSmtc();
    registerShortcuts();

    if (cfg.all().wallpaperMode) {
      setTimeout(applyWallpaperMode, 1200); // re-assert once everything settled
    }

    if (!isDev) {
      try {
        tray.displayBalloon({
          title: 'Freewave is running',
          content: 'Live visuals are now behind your desktop icons. Open the tray icon for settings, theater mode and lyrics.'
        });
      } catch {}
    }

    screen.on('display-metrics-changed', () => {
      if (cfg.all().wallpaperMode && wallpaperWin && !wallpaperWin.isDestroyed()) {
        wallpaper.reposition(wallpaperWin);
      }
      repositionLyricsWindow();
    });

    console.log('[main] Freewave ready (dev=' + isDev + ')');
  });

  app.on('before-quit', () => {
    quitting = true;
    if (poller) poller.stop();
    try { globalShortcut.unregisterAll(); } catch {}
  });

  app.on('will-quit', () => {
    if (poller) poller.stop();
  });

  app.on('window-all-closed', () => {
    // Tray app: keep running unless quitting was requested.
    if (quitting) app.quit();
  });
}
