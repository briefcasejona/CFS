// Persistent user settings (localStorage key 'cfs.settings.v1').

export interface Settings {
  // realism (DCS-style "Sim" defaults; each can be relaxed for accessibility)
  unlimitedFuel: boolean;
  unlimitedWeapons: boolean;
  invulnerable: boolean;
  gEffects: boolean;
  labels: boolean;
  easyRadar: boolean;
  /** start cold and dark on the ramp, engine off (f16/systems.ts), when the mission starts at an airbase */
  coldStart: boolean;
  // controls
  abDetent: number;           // throttle position of the afterburner detent 0..1
  keyboardSensitivity: number;
  /** the mouse wheel turns the F-16's cockpit knobs and wheels the other way */
  cockpitWheelReverse: boolean;
  /** cockpit knobs and wheels (control ids) whose mouse direction, and bound joystick axis, are reversed */
  cockpitReverse: string[];
  // graphics
  fov: number;
  visibilityKm: number;
  /** high-detail glTF models where available (F-14, Gripen) */
  hdModels: boolean;
  /** Sentinel-2 satellite imagery on the real-world maps (streamed from EOX) */
  satImagery: boolean;
  /** ~25 m elevation streamed around the aircraft on the real-world maps (AWS Terrain Tiles) */
  fineTerrain: boolean;
  /** graphics quality: 'auto' (holds ~60 fps, as much detail as the PC allows) or a fixed level 0 Low … 3 Ultra */
  graphicsQuality: 'auto' | number;
  // audio
  volume: number;
  /** push-to-talk voice commands (browser speech recognition; off by default — audio goes to the browser's speech service) */
  voiceCommands: boolean;
  // HUD
  hudColor: string;
  // menu
  /** main-menu theme: 'f14' | 'f16' | 'f15' */
  menuTheme: string;
  /** photo background in the menus (loaded from Wikimedia Commons); off = plain backdrop, nothing downloaded */
  menuPhotos: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  unlimitedFuel: false,
  unlimitedWeapons: false,
  invulnerable: false,
  gEffects: true,
  labels: false,
  easyRadar: false,
  coldStart: false,
  abDetent: 0.8,
  keyboardSensitivity: 1,
  cockpitWheelReverse: false,
  cockpitReverse: [],
  fov: 75,
  visibilityKm: 80,
  hdModels: true,
  satImagery: true,
  fineTerrain: true,
  graphicsQuality: 'auto',
  volume: 0.6,
  voiceCommands: false,
  hudColor: '#3dff7a',
  menuTheme: 'f16',
  menuPhotos: true,
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
