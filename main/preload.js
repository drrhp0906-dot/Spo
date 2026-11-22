'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('freewave', {
  // subscriptions
  onTrack: (cb) => ipcRenderer.on('track:update', (_e, d) => cb(d)),
  onPosition: (cb) => ipcRenderer.on('track:position', (_e, d) => cb(d)),
  onLyrics: (cb) => ipcRenderer.on('lyrics:update', (_e, d) => cb(d)),
  onArtwork: (cb) => ipcRenderer.on('artwork:update', (_e, d) => cb(d)),
  onSettings: (cb) => ipcRenderer.on('settings:updated', (_e, d) => cb(d)),
  onAudioRetry: (cb) => ipcRenderer.on('audio:retry', (_e) => cb()),
  onLyricsLock: (cb) => ipcRenderer.on('lyrics:lock', (_e, d) => cb(d)),
  onAudioLevel: (cb) => ipcRenderer.on('audio:level', (_e, d) => cb(d)),

  // queries / commands
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getState: () => ipcRenderer.invoke('state:get'),
  chooseAudioFile: () => ipcRenderer.invoke('dialog:audioFile'),
  setManualTrack: (t) => ipcRenderer.invoke('track:manual', t),
  togglePlayback: () => ipcRenderer.invoke('playback:toggle'),
  reportAudioLevel: (payload) => ipcRenderer.send('audio:level', payload),
  theaterToggle: () => ipcRenderer.invoke('theater:toggle'),
  theaterClose: () => ipcRenderer.invoke('theater:close'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  windowAction: (a) => ipcRenderer.invoke('window:action', a)
});
