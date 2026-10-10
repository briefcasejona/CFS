// Persistent user settings (localStorage key 'cfs.settings.v1').

export interface Settings {
  // realism (DCS-style "Sim" defaults; each can be relaxed for accessibility)
  unlimitedFuel: boolean;
  unlimitedWeapons: boolean;
  invulnerable: boolean;
  gEffects: boolean;
  labels: boolean;
  easyRadar: boolean;
  // controls
  abDetent: number;           // throttle position of the afterburner detent 0..1
  keyboardSensitivity: number;
  // graphics
  fov: number;
  visibilityKm: number;
  // audio
  volume: number;
  // HUD
  hudColor: string;
}

export const DEFAULT_SETTINGS: Settings = {
  unlimitedFuel: false,
  unlimitedWeapons: false,
  invulnerable: false,
  gEffects: true,
  labels: false,
  easyRadar: false,
  abDetent: 0.8,
  keyboardSensitivity: 1,
  fov: 75,
  visibilityKm: 80,
  volume: 0.6,
  hudColor: '#3dff7a',
};

const KEY = 'cfs.settings.v1';

export function loadSettings(): Settings {
  try {
    const s = localStorage.getItem(KEY);
    return { ...DEFAULT_SETTINGS, ...(s ? JSON.parse(s) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export function realismLabel(s: Settings) {
  const relaxed = [s.unlimitedFuel, s.unlimitedWeapons, s.invulnerable, !s.gEffects, s.labels, s.easyRadar].filter(Boolean).length;
  return relaxed === 0 ? 'Full realism' : relaxed <= 2 ? 'Relaxed' : 'Game mode';
}
