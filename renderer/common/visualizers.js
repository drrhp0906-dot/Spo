'use strict';

/**
 * Freewave visualizers — all 10, every single one free.
 *
 * Includes everything Weyv gates behind its $9.99 Pro license
 * (Orb, Particles, Terrain, Waterfall) plus the classics.
 * Each visualizer is { id, name, draw(frame, settings) }.
 *
 * frame = {
 *   ctx, w, h, dt, t,
 *   colors: { bg, primary, secondary, accent },
 *   data: { freq: Uint8Array(1024), time: Uint8Array(2048) },
 *   bands: { bass, mid, treble, level, beat (0..1 flash), rawBass,
 *            spectrum(count) -> Float32Array log-spaced 0..~1.6 }
 * }
 */

(function () {
  const registry = [];

  // ------------------------------------------------------------------ utils
  function grad(ctx, colors, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, colors.primary);
    g.addColorStop(0.6, colors.secondary);
    g.addColorStop(1, colors.accent);
    return g;
  }

  function glow(ctx, color, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function noGlow(ctx) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  function hexA(hex, a) {
    const m = String(hex).replace('#', '');
    const n = parseInt(m.length === 3 ? m.replace(/./g, (c) => c + c) : m, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ------------------------------------------------------------------ bars
  const barsState = { peaks: null, vals: null };
  registry.push({
    id: 'bars',
    name: 'Bars',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;
      const n = 64;
      if (!barsState.vals) {
        barsState.vals = new Float32Array(n);
        barsState.peaks = new Float32Array(n);
      }
      const spec = bands.spectrum(n);
      const pad = w * 0.06;
      const bw = (w - pad * 2) / n;
      const baseY = h * 0.86;
      const maxH = h * 0.62;

      for (let i = 0; i < n; i++) {
        // gentle temporal smoothing for silky motion
        barsState.vals[i] += (spec[i] - barsState.vals[i]) * Math.min(1, f.dt * 22);
        const v = barsState.vals[i];
        const bh = Math.max(2, v * maxH);
        const x = pad + i * bw + bw * 0.12;
        const bwi = bw * 0.76;

        const g = ctx.createLinearGradient(0, baseY - bh, 0, baseY);
        g.addColorStop(0, colors.accent);
        g.addColorStop(0.45, colors.primary);
        g.addColorStop(1, hexA(colors.secondary, 0.55));
        glow(ctx, colors.primary, 16);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, baseY - bh, bwi, bh, Math.min(5, bwi / 2));
        ctx.fill();
        noGlow(ctx);

        // falling peak cap
        barsState.peaks[i] = Math.max(bh, barsState.peaks[i] - maxH * f.dt * 0.35);
        ctx.fillStyle = hexA(colors.accent, 0.85);
        ctx.fillRect(x, baseY - barsState.peaks[i] - 4, bwi, 2.5);
      }

      // soft floor line
      glow(ctx, colors.secondary, 10);
      ctx.strokeStyle = hexA(colors.secondary, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, baseY + 1.5);
      ctx.lineTo(w - pad, baseY + 1.5);
      ctx.stroke();
      noGlow(ctx);
    }
  });

  // ------------------------------------------------------------------ mirror
  registry.push({
    id: 'mirror',
    name: 'Mirror',
    draw(f) {
      const { ctx, w, h, data, colors } = f;
      const midY = h / 2;
      const amp = h * 0.26;
      const step = Math.max(4, Math.floor(data.time.length / (w / 4)));

      glow(ctx, colors.primary, 22);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0, x = 0; i < data.time.length; i += step, x += 4) {
        const v = (data.time[i] - 128) / 128;
        const y = midY - v * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      noGlow(ctx);

      // mirrored fill
      ctx.globalAlpha = 0.22;
      const g = grad(ctx, colors, 0, midY, 0, midY + amp);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0, x = 0; i < data.time.length; i += step, x += 4) {
        const v = (data.time[i] - 128) / 128;
        ctx.lineTo(x, midY - v * amp);
      }
      ctx.lineTo(w, midY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // horizon glow line, pulsing with bass
      ctx.strokeStyle = hexA(colors.accent, 0.35 + f.bands.bass * 0.5);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, midY);
      ctx.lineTo(w, midY);
      ctx.stroke();
    }
  });

  // ------------------------------------------------------------------ blocks
  const blocksState = { cols: 40, rows: 10 };
  registry.push({
    id: 'blocks',
    name: 'Blocks',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;
      const { cols, rows } = blocksState;
      const spec = bands.spectrum(cols);
      const padX = w * 0.05;
      const padY = h * 0.12;
      const cw = (w - padX * 2) / cols;
      const ch = Math.min((h - padY * 2) / rows, 26);
      const baseY = h - padY;

      for (let c = 0; c < cols; c++) {
        const lit = Math.round(Math.min(1, spec[c]) * rows);
        for (let r = 0; r < rows; r++) {
          const x = padX + c * cw + cw * 0.12;
          const y = baseY - (r + 1) * (ch + 3);
          const isTop = r === lit - 1;
          if (r < lit) {
            ctx.fillStyle = isTop ? colors.accent : colors.primary;
            if (isTop) glow(ctx, colors.accent, 12);
            ctx.beginPath();
            ctx.roundRect(x, y, cw * 0.76, ch, 3);
            ctx.fill();
            if (isTop) noGlow(ctx);
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.045)';
            ctx.beginPath();
            ctx.roundRect(x, y, cw * 0.76, ch, 3);
            ctx.fill();
          }
        }
      }
    }
  });

  // ------------------------------------------------------------------ waveform
  const waveHistory = [];
  registry.push({
    id: 'waveform',
    name: 'Waveform',
    draw(f) {
      const { ctx, w, h, data, colors, bands } = f;
      const midY = h * 0.52;
      const amp = h * 0.22;

      // ghost trail: keep a few past waveforms
      waveHistory.push(Float32Array.from({ length: 96 }, (_, i) => {
        const idx = Math.floor((i / 96) * (data.time.length - 1));
        return Math.abs((data.time[idx] - 128) / 128);
      }));
      if (waveHistory.length > 5) waveHistory.shift();

      waveHistory.forEach((hist, hi) => {
        const alpha = 0.05 + hi * 0.04;
        ctx.strokeStyle = hexA(colors.secondary, alpha);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const yOff = midY - (waveHistory.length - hi) * 14;
        hist.forEach((v, i) => {
          const x = (i / (hist.length - 1)) * w;
          const y = yOff + v * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });

      // main oscilloscope line
      glow(ctx, colors.primary, 24);
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      const N = 128;
      for (let i = 0; i <= N; i++) {
        const idx = Math.floor((i / N) * (data.time.length - 1));
        const v = (data.time[idx] - 128) / 128;
        const x = (i / N) * w;
        const y = midY + v * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      noGlow(ctx);

      // beat pulse dot
      if (bands.beat > 0.05) {
        ctx.fillStyle = hexA(colors.accent, bands.beat * 0.9);
        ctx.beginPath();
        ctx.arc(w * 0.94, midY, 6 + bands.beat * 10, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // ------------------------------------------------------------------ ring
  const ringState = { rot: 0 };
  registry.push({
    id: 'ring',
    name: 'Ring',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;
      const cx = w / 2;
      const cy = h / 2;
      const n = 96;
      const spec = bands.spectrum(n);
      const minR = Math.min(w, h) * 0.17 + bands.bass * 26;
      const maxLen = Math.min(w, h) * 0.20;

      ringState.rot += f.dt * (0.12 + bands.mid * 0.5);

      // outer bars
      for (let i = 0; i < n; i++) {
        const a = ringState.rot + (i / n) * Math.PI * 2;
        const len = 4 + spec[i] * maxLen;
        const x0 = cx + Math.cos(a) * minR;
        const y0 = cy + Math.sin(a) * minR;
        const x1 = cx + Math.cos(a) * (minR + len);
        const y1 = cy + Math.sin(a) * (minR + len);
        const t = spec[i];
        ctx.strokeStyle = t > 0.72 ? colors.accent : hexA(colors.secondary, 0.9);
        glow(ctx, colors.primary, 8);
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        noGlow(ctx);
      }

      // center disc
      const rg = ctx.createRadialGradient(cx, cy, 2, cx, cy, minR);
      rg.addColorStop(0, hexA(colors.accent, 0.85));
      rg.addColorStop(0.5, hexA(colors.primary, 0.28));
      rg.addColorStop(1, hexA(colors.primary, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, minR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = hexA(colors.accent, 0.6);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy, minR, 0, Math.PI * 2);
      ctx.stroke();

      // beat ring
      if (bands.beat > 0.05) {
        ctx.strokeStyle = hexA(colors.accent, bands.beat * 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, minR + (1 - bands.beat) * 60, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  });

  // ------------------------------------------------------------------ aurora
  const auroraState = { phases: [0, 1.7, 3.9] };
  registry.push({
    id: 'aurora',
    name: 'Aurora',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      const layers = [
        { energy: bands.bass, amp: h * 0.16, y: h * 0.42, width: 34, color: colors.primary, alpha: 0.20 },
        { energy: bands.mid, amp: h * 0.12, y: h * 0.55, width: 26, color: colors.secondary, alpha: 0.20 },
        { energy: bands.treble, amp: h * 0.08, y: h * 0.66, width: 18, color: colors.accent, alpha: 0.16 }
      ];

      layers.forEach((L, li) => {
        auroraState.phases[li] += f.dt * (0.25 + L.energy * 1.1);
        const ph = auroraState.phases[li];
        glow(ctx, L.color, 40);

        ctx.strokeStyle = hexA(L.color, L.alpha + L.energy * 0.25);
        ctx.lineWidth = L.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let x = -40; x <= w + 40; x += 12) {
          const u = x / w;
          const y = L.y
            + Math.sin(u * 4.2 + ph) * L.amp * (0.35 + L.energy)
            + Math.sin(u * 9.1 - ph * 1.6) * L.amp * 0.35 * (0.3 + L.energy * 1.4)
            + Math.sin(u * 17.3 + ph * 0.7) * L.amp * 0.12 * L.energy;
          if (x === -40) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      noGlow(ctx);
      ctx.restore();
    }
  });

  // ------------------------------------------------------------------ orb (Pro-style, free here)
  const orbState = { rings: [], orbiters: null };
  registry.push({
    id: 'orb',
    name: 'Orb',
    draw(f) {
      const { ctx, w, h, bands, colors, dt } = f;
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.14;
      const R = baseR + bands.bass * baseR * 0.7 + bands.beat * 10;

      if (!orbState.orbiters) {
        orbState.orbiters = Array.from({ length: 70 }, () => ({
          a: Math.random() * Math.PI * 2,
          d: 1.3 + Math.random() * 1.6,
          sp: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
          s: 1 + Math.random() * 2.6
        }));
      }

      // expanding rings on beats
      if (bands.beat > 0.6) {
        orbState.rings.push({ r: R * 1.15, a: 0.55 });
      }
      orbState.rings.forEach((r) => { r.r += dt * 220; r.a -= dt * 0.55; });
      orbState.rings = orbState.rings.filter((r) => r.a > 0);
      orbState.rings.forEach((r) => {
        ctx.strokeStyle = hexA(colors.secondary, r.a);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r.r, 0, Math.PI * 2);
        ctx.stroke();
      });

      // glow body
      const rg = ctx.createRadialGradient(cx, cy, 1, cx, cy, R * 2.4);
      rg.addColorStop(0, hexA(colors.accent, 0.95));
      rg.addColorStop(0.28, hexA(colors.primary, 0.55));
      rg.addColorStop(0.65, hexA(colors.primary, 0.16));
      rg.addColorStop(1, hexA(colors.primary, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // core
      ctx.fillStyle = colors.accent;
      glow(ctx, colors.accent, 26);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
      ctx.fill();
      noGlow(ctx);

      // orbiters react to treble
      glow(ctx, colors.secondary, 10);
      orbState.orbiters.forEach((o) => {
        o.a += dt * o.sp * (0.4 + bands.treble * 2.6);
        const d = R * o.d;
        const x = cx + Math.cos(o.a) * d;
        const y = cy + Math.sin(o.a) * d * 0.62; // slight ellipse
        ctx.fillStyle = hexA(colors.secondary, 0.8);
        ctx.beginPath();
        ctx.arc(x, y, o.s * (0.7 + bands.treble * 2.2), 0, Math.PI * 2);
        ctx.fill();
      });
      noGlow(ctx);
    }
  });

  // ------------------------------------------------------------------ particles (Pro-style, free here)
  const particlesState = { ps: null };
  registry.push({
    id: 'particles',
    name: 'Particles',
    draw(f) {
      const { ctx, w, h, bands, colors, dt } = f;
      if (!particlesState.ps) {
        particlesState.ps = Array.from({ length: 260 }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 30,
          vy: (Math.random() - 0.5) * 30,
          s: 0.8 + Math.random() * 2.4
        }));
      }
      const speed = 26 + bands.level * 340;
      const burst = bands.beat * 160;

      glow(ctx, colors.primary, 8);
      particlesState.ps.forEach((p) => {
        // energy pushes particles away from center, direction by position
        const dx = p.x - w / 2;
        const dy = p.y - h / 2;
        const d = Math.max(60, Math.hypot(dx, dy));
        p.vx += (dx / d) * speed * dt * (0.4 + bands.bass);
        p.vy += (dy / d) * speed * dt * (0.4 + bands.bass);
        if (burst > 2) {
          p.vx += (dx / d) * burst;
          p.vy += (dy / d) * burst;
        }
        // damping + wrap
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0) p.x += w;
        if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h;
        if (p.y > h) p.y -= h;

        const heat = Math.min(1, bands.level * 1.6 + 0.25);
        ctx.fillStyle = heat > 0.8 ? hexA(colors.accent, 0.9) : hexA(colors.secondary, 0.35 + heat * 0.6);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s * (0.8 + bands.mid * 1.8), 0, Math.PI * 2);
        ctx.fill();
      });
      noGlow(ctx);
    }
  });

  // ------------------------------------------------------------------ terrain (Pro-style, free here)
  const terrainState = { rows: [], maxRows: 34, cols: 64, frameCount: 0 };
  registry.push({
    id: 'terrain',
    name: 'Terrain',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;
      const { cols, maxRows } = terrainState;

      terrainState.frameCount++;
      if (terrainState.frameCount % 2 === 0) {
        const spec = bands.spectrum(cols);
        terrainState.rows.push(spec);
        if (terrainState.rows.length > maxRows) terrainState.rows.shift();
      }

      const frontY = h * 0.86;
      const backY = h * 0.24;
      const rowH = (frontY - backY) / maxRows;

      for (let ri = 0; ri < terrainState.rows.length; ri++) {
        const row = terrainState.rows[ri];
        const depth = ri / maxRows; // 0 = back
        const y = backY + depth * (frontY - backY);
        const scale = 0.45 + depth * 0.55;
        const amp = rowH * 4.2 * scale;

        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let c = 0; c < cols; c++) {
          const x = (c / (cols - 1)) * w;
          ctx.lineTo(x, y - row[c] * amp);
        }
        ctx.lineTo(w, y);

        const isFront = ri === terrainState.rows.length - 1;
        ctx.strokeStyle = isFront
          ? hexA(colors.accent, 0.95)
          : hexA(depth > 0.5 ? colors.primary : colors.secondary, 0.28 + depth * 0.45);
        ctx.lineWidth = isFront ? 2 : 1.1;
        glow(ctx, colors.primary, isFront ? 12 : 0);
        ctx.stroke();
        noGlow(ctx);

        ctx.fillStyle = hexA(colors.bg, 0.82); // occlude rows behind
        ctx.lineTo(w, y + rowH);
        ctx.lineTo(0, y + rowH);
        ctx.closePath();
        ctx.fill();
      }
    }
  });

  // ------------------------------------------------------------------ waterfall (Pro-style, free here)
  const waterfallState = { off: null, offCtx: null, fw: 0, fh: 0 };
  registry.push({
    id: 'waterfall',
    name: 'Waterfall',
    draw(f) {
      const { ctx, w, h, bands, colors } = f;

      if (!waterfallState.off || waterfallState.fw !== Math.round(w)) {
        waterfallState.fw = Math.round(w);
        waterfallState.fh = Math.round(h);
        waterfallState.off = document.createElement('canvas');
        waterfallState.off.width = waterfallState.fw;
        waterfallState.off.height = waterfallState.fh;
        waterfallState.offCtx = waterfallState.off.getContext('2d');
        waterfallState.offCtx.fillStyle = colors.bg;
        waterfallState.offCtx.fillRect(0, 0, w, h);
      }
      const o = waterfallState.offCtx;

      // scroll down by 2px and paint a fresh spectrum line at the top
      o.drawImage(waterfallState.off, 0, 0, w, h - 2, 0, 2, w, h - 2);
      const spec = bands.spectrum(160);
      const colW = w / 160;
      for (let i = 0; i < 160; i++) {
        const v = Math.min(1, spec[i]);
        let c;
        if (v < 0.02) c = colors.bg;
        else if (v < 0.35) c = hexA(colors.secondary, 0.25 + v * 1.4);
        else if (v < 0.7) c = colors.primary;
        else c = colors.accent;
        o.fillStyle = c;
        o.fillRect(i * colW, 0, colW + 0.5, 2);
      }

      ctx.save();
      glow(ctx, colors.primary, 18);
      ctx.drawImage(waterfallState.off, 0, 0);
      noGlow(ctx);
      ctx.restore();

      // scanline
      ctx.strokeStyle = hexA(colors.accent, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 1);
      ctx.lineTo(w, 1);
      ctx.stroke();
    }
  });

  // ------------------------------------------------------------------ export
  window.FreewaveVisualizers = { registry };
})();
