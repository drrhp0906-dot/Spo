'use strict';

/**
 * Freewave theme presets + color resolution.
 * Every visualizer and every window reads colors from here.
 */

const THEMES = [
  { id: 'neonPulse',   name: 'Neon Pulse',   colors: { bg: '#07000f', primary: '#ff2fd6', secondary: '#2fe9ff', accent: '#ffe14d' } },
  { id: 'sunsetDrive', name: 'Sunset Drive', colors: { bg: '#12030a', primary: '#ff6b35', secondary: '#ff2e63', accent: '#ffd23f' } },
  { id: 'cyberMint',   name: 'Cyber Mint',   colors: { bg: '#00110d', primary: '#00ffc8', secondary: '#00b3ff', accent: '#eafff8' } },
  { id: 'deepSpace',   name: 'Deep Space',   colors: { bg: '#05010d', primary: '#7c4dff', secondary: '#00e5ff', accent: '#ff4081' } },
  { id: 'cherryCola',  name: 'Cherry Cola',  colors: { bg: '#0d0104', primary: '#ff1744', secondary: '#ff8a65', accent: '#ffd54f' } },
  { id: 'monoWave',    name: 'Mono Wave',    colors: { bg: '#000000', primary: '#ffffff', secondary: '#b9b9c9', accent: '#ffffff' } }
];

function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Resolve the effective palette from config (custom colors win). */
function resolveColors(config) {
  const base = themeById(config.theme).colors;
  const c = config.customColors;
  if (!c) return { ...base };
  return {
    bg: c.bg || base.bg,
    primary: c.primary || base.primary,
    secondary: c.secondary || base.secondary,
    accent: c.accent || base.accent
  };
}

window.FreewaveThemes = { THEMES, themeById, resolveColors };
