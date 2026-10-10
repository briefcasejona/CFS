import { InputManager, shortDev } from './input/input.js';
import { AudioSystem } from './core/audio.js';
import { loadSettings, type Settings } from './core/settings.js';
import { FlightSession, type EndCallback, type NetHook } from './game/session.js';
import { mainMenu, type AppApi } from './ui/screens.js';
import { controlsScreen } from './ui/controls.js';
import { openCampaign } from './ui/campaignScreen.js';
import type { MissionSpec } from './game/mission.js';
import { installErrorOverlay } from './ui/errorOverlay.js';
import { setHdModelsEnabled } from './render/hdModels.js';
import { ensureTheater } from './world/theater.js';

class App implements AppApi {
  root: HTMLElement;
  settings: Settings;
  input = new InputManager();
  audio = new AudioSystem();
  private session: FlightSession | null = null;
  private toastTimer = 0;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.settings = loadSettings();
    setHdModelsEnabled(this.settings.hdModels);
    this.input.onDeviceConnected = (id, auto) => this.toast(`Controller connected: ${shortDev(id)}${auto ? ' — default HOTAS profile applied (check Controls)' : ''}`);
    const unlock = () => {
      this.audio.init(this.settings.volume);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.mainMenu();
    void this.openSharedMission();
  }

  /** #mission=… links (shared from the mission editor) open straight into the editor. */
  private async openSharedMission() {
    const m = /#mission=([\w-]+)/.exec(location.hash);
    if (!m) return;
    try {
      const { decodeMission } = await import('./game/missionFile.js');
      const { editorScreen } = await import('./ui/editor.js');
      const spec = await decodeMission(m[1]);
      history.replaceState(null, '', location.pathname + location.search);
      this.show(() => editorScreen(this, spec));
      this.toast(`Shared mission loaded: ${spec.title}`);
    } catch (err) { this.toast(`Could not open the shared mission: ${(err as Error).message}`); }
  }

  show(screen: () => HTMLElement) {
    this.root.style.display = 'block';
    this.root.innerHTML = '';
    this.root.append(screen());
  }

  mainMenu() { this.show(() => mainMenu(this)); }
  controls() { this.show(() => controlsScreen(this, this.input)); }
  campaign() { openCampaign(this); }

  toast(msg: string) {
    const t = document.getElementById('toast')!;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 3500);
  }

  fly(spec: MissionSpec, onEnd: EndCallback, net?: NetHook) {
    this.audio.init(this.settings.volume);
    this.audio.setVolume(this.settings.volume);
    const loading = document.getElementById('loading')!;
    loading.style.display = 'flex';
    this.root.style.display = 'none';
    // let the loading screen paint before the terrain prewarm
    setTimeout(async () => {
      try {
        await ensureTheater(spec.theaterId); // real-world theaters download their terrain first
        if (!this.session) {
          this.session = new FlightSession({
            root: document.getElementById('sim')!,
            canvas3d: document.getElementById('c3d') as HTMLCanvasElement,
            hud: document.getElementById('hud') as HTMLCanvasElement,
            mfdL: document.getElementById('mfdL') as HTMLCanvasElement,
            mfdR: document.getElementById('mfdR') as HTMLCanvasElement,
            map: document.getElementById('map') as HTMLCanvasElement,
            overlay: document.getElementById('overlay')!,
          }, this.input, this.audio, this.settings);
        }
        this.session.settings = this.settings;
        this.session.netHook = net ?? null;
        this.session.start(spec, (r, b) => {
          this.root.style.display = 'block';
          onEnd(r, b);
        });
      } catch (err) {
        console.error(err);
        this.root.style.display = 'block';
        this.toast(`Could not start mission: ${(err as Error).message}`);
      } finally {
        loading.style.display = 'none';
      }
    }, 50);
  }
}

function boot() {
  installErrorOverlay();
  try {
    (window as unknown as { cfs: App }).cfs = new App();
  } catch (err) {
    document.body.innerHTML = `<pre style="color:#f88;padding:20px">CFS failed to start:\n${String((err as Error).stack ?? err)}</pre>`;
  }
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();
