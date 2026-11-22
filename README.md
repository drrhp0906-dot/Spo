# Freewave

**A completely free desktop music visualizer for Windows.** Live visuals behind your desktop icons, reacting to whatever plays through your PC — Spotify, YouTube, VLC, anything. Plus a desktop clock, a now-playing card, full-screen theater mode and **synced karaoke lyrics floating on top of every window**.

Inspired by [Weyv](https://www.weyv.app), but with every visualizer unlocked and **$0 forever** — no Pro tier, no account, no telemetry.

---

## Freewave vs Weyv

| Feature | Weyv Free | Weyv Pro ($9.99) | **Freewave** |
| --- | --- | --- | --- |
| Classic visualizers (Bars, Mirror, Ring, Blocks, Waveform, Aurora) | Yes | Yes | **Yes** |
| Pro visualizers (Orb, Particles, Terrain, Waterfall) | — | $9.99 | **Yes — all free** |
| Desktop clock styles | Yes | Yes | **4 styles** (Digital / Analog / Minimal / Words) |
| Now-playing card | Basic | 4 layouts | **Card + Minimal + live progress** |
| Full-screen theater mode | Yes | Yes | **Yes, with album-art backdrop** |
| Lyrics | Basic | Advanced | **Synced (LRC) overlay on top of any window** |
| Works with Spotify / YouTube / VLC | Yes (SMTC) | Yes (SMTC) | **Yes (SMTC)** |
| Themes | Limited | Full | **6 presets + custom color editor** |
| Price | $0 | $9.99 one-time | **$0, MIT-licensed, forever** |

---

## Requirements

- Windows 10 (1903+) or Windows 11
- [Node.js](https://nodejs.org) 18 or newer (only needed to run/build; end users of the installer don't need it)
- Internet for lyrics (LRCLIB) and album art (iTunes) — the visualizer itself works offline

## Run from source

```bash
npm install
npm start
```

That's it — Freewave starts minimized to the tray and paints the visualizer behind your desktop icons. No compiler, no Rust toolchain, no native build step: the only native dependency (`koffi`) ships prebuilt.

## Build an installer / portable exe

```bash
npm run dist
```

Output lands in `dist/`:

- `Freewave-Setup-<version>.exe` — NSIS installer
- `Freewave-Portable-<version>.exe` — single-file portable app

(Windows SmartScreen may warn on first launch of self-built binaries — that's expected for unsigned builds. Click "More info" → "Run anyway".)

---

## How it works

```
+---------------------+      SMTC (System Media Transport Controls)
| Spotify / YouTube / | --->  Windows "now playing" info
| VLC / any player    |        title, artist, album, position, status
+---------------------+
        | plays audio                        |
        v                                    v
+------------------------------------+   +---------------------------+
| Wallpaper window (behind icons)    |   | scripts/smtc.ps1          |
| - system audio loopback capture    |   | polls SMTC via WinRT      |
| - Web Audio FFT -> Canvas          |   | emits JSON lines          |
| - 10 visualizers + clock + card    |   +-------------+-------------+
+------------------------------------+                 |
        |                                              v
        |                              +--------------------------------+
        |                              | Main process                   |
        |                              | - track state machine          |
        |                              | - lyrics: LRCLIB (free API)    |
        |                              | - artwork: iTunes Search       |
        |                              | - tray, settings, shortcuts    |
        |                              +---+-----------+----------------+
        v                                  |           |
+----------------------+                   |           |
| Lyrics overlay       | <-----------------+           |
| always on top        |   lyrics:update / track:position
| karaoke sync (LRC)   |
+----------------------+                   v
                              +----------------------+
                              | Theater mode window  |
                              | fullscreen + lyrics  |
                              +----------------------+
```

- **Audio** — the wallpaper renderer calls `getDisplayMedia`; the main process auto-grants it with `audio: 'loopback'`, which on Windows captures system audio directly (WASAPI loopback). No microphone needed and the visualizer reacts to *everything*, exactly like Weyv.
- **Wallpaper** — the classic `Progman`/`WorkerW` trick: Electron's window is reparented to the WorkerW layer behind desktop icons, so icons stay visible and clickable. Implemented via `koffi` (prebuilt FFI) — no native compilation. If koffi can't load (e.g. antivirus quarantines the binary), Freewave automatically retries with a small PowerShell helper (`scripts/attach.ps1`). Falls back to a frameless fullscreen window if the shell refuses.
- **Spotify metadata** — `scripts/smtc.ps1` polls Windows System Media Transport Controls once per 600 ms and streams JSON to the main process. Spotify (desktop or Store), browsers, VLC, foobar2000 — anything that shows in the Windows media overlay just works.
- **Lyrics** — [LRCLIB](https://lrclib.net) (free, open, no API key) provides synced LRC or plain lyrics; the overlay syncs via the SMTC playback position with a user-adjustable offset. Results are cached on disk so replays and offline reuse are instant.
- **Album art** — iTunes Search API (free, no key), cached per track under `userData/artcache`.

## Features

- **10 visualizers**: Bars, Mirror, Ring, Blocks, Waveform, Aurora + the "Pro" ones — Orb, Particles, Terrain, Waterfall. Every one free.
- **Desktop clock**: Digital, Analog, Minimal and Words styles, any corner, 12/24 h.
- **Now-playing card**: album art, title, artist, progress bar, and the current lyric line under it. Card and Minimal layouts.
- **Lyrics overlay**: always-on-top, click-through, drag-repositionable from the tray, sync offset slider.
- **Theater mode**: full-screen visuals over a blurred album-art backdrop with big synced lyrics (`Ctrl+Alt+F`).
- **Theme editor**: 6 neon presets (Neon Pulse, Sunset Drive, Cyber Mint, Deep Space, Cherry Cola, Mono Wave) plus per-channel color pickers.
- **Audio sources**: system loopback / microphone / local file with "Artist - Title" lyric lookup.
- **Tray app**: play/pause any media session, toggle overlays, quit. Starts with Windows (optional).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Visuals are flat / not reacting | Check music is actually playing, then Settings → Audio → **Reconnect audio**. Windows shows a capture prompt the first time — accept it. |
| "Could not capture system audio" | Some drivers block loopback. Use the microphone source, or file mode. |
| Wallpaper visualizer not behind icons | Check the console for `[main] visualizer attached behind desktop icons (via koffi)` or `(via powershell)`. Settings → General → toggle "Visualizer as wallpaper" off and on. If both attach paths fail, Freewave falls back to a fullscreen borderless window. |
| Lyrics don't appear | Lyrics come from LRCLIB — very new or very obscure tracks may not be indexed yet. Instrumental tracks legitimately return none. |
| Lyrics slightly off-beat | Settings → Overlays → **Sync offset** slider (also per-session while testing). |
| Now playing shows nothing | The `powershell.exe` poller requires Windows 10+ with the media overlay. Check that Windows Media Player features aren't stripped (N editions need the Media Feature Pack). |
| Clock/card in the wrong corner | Settings → Overlays → corner dropdowns. |

## Privacy

Freewave has **no accounts, no analytics, no telemetry**. The only outbound requests are lyric lookups (LRCLIB) and artwork lookups (iTunes Search), both anonymous.

## Credits

- [Electron](https://www.electronjs.org) — app runtime
- [koffi](https://koffi.dev) — prebuilt FFI for the WorkerW wallpaper trick
- [LRCLIB](https://lrclib.net) — free and open lyrics database
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) — album artwork
- The Weyv team for the concept inspiration — this project exists because the idea deserves a free version.

Licensed under the [MIT License](LICENSE).
