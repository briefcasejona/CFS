// Procedural WebAudio: engine, wind, gun, missile seeker tone, RWR and warning tones.

export class AudioSystem {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engGain!: GainNode; private engOsc!: OscillatorNode; private engFilter!: BiquadFilterNode;
  private abGain!: GainNode;
  private windGain!: GainNode; private windFilter!: BiquadFilterNode;
  private gunGain!: GainNode;
  private toneGain!: GainNode; private toneOsc!: OscillatorNode; private toneLfoGain!: GainNode;
  private warnGain!: GainNode;
  private rwrGain!: GainNode;
  private beepTimer = 0;

  /** Must be called from a user gesture (browser autoplay policy). */
  init(volume: number) {
    if (this.ctx) { this.setVolume(volume); this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx() as AudioContext;
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.setVolume(volume);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    noiseSrc().connect(this.engFilter).connect(this.engGain).connect(this.master);
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 120;
    const whine = ctx.createGain(); whine.gain.value = 0.03;
    this.engOsc.connect(whine).connect(this.engGain); this.engOsc.start();
    const abF = ctx.createBiquadFilter(); abF.type = 'lowpass'; abF.frequency.value = 160;
    this.abGain = ctx.createGain(); this.abGain.gain.value = 0;
    noiseSrc().connect(abF).connect(this.abGain).connect(this.master);
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 800; this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    noiseSrc().connect(this.windFilter).connect(this.windGain).connect(this.master);
    const gunF = ctx.createBiquadFilter(); gunF.type = 'lowpass'; gunF.frequency.value = 900;
    this.gunGain = ctx.createGain(); this.gunGain.gain.value = 0;
    noiseSrc().connect(gunF).connect(this.gunGain).connect(this.master);
    this.toneOsc = ctx.createOscillator(); this.toneOsc.type = 'sine'; this.toneOsc.frequency.value = 600;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
    this.toneLfoGain = ctx.createGain(); this.toneLfoGain.gain.value = 120;
    lfo.connect(this.toneLfoGain).connect(this.toneOsc.frequency);
    this.toneGain = ctx.createGain(); this.toneGain.gain.value = 0;
    this.toneOsc.connect(this.toneGain).connect(this.master);
    this.toneOsc.start(); lfo.start();
    const warnOsc = ctx.createOscillator(); warnOsc.type = 'square'; warnOsc.frequency.value = 880;
    this.warnGain = ctx.createGain(); this.warnGain.gain.value = 0;
    warnOsc.connect(this.warnGain).connect(this.master); warnOsc.start();
    const rwrOsc = ctx.createOscillator(); rwrOsc.type = 'square'; rwrOsc.frequency.value = 1300;
    this.rwrGain = ctx.createGain(); this.rwrGain.gain.value = 0;
    rwrOsc.connect(this.rwrGain).connect(this.master); rwrOsc.start();
  }

  setVolume(v: number) { if (this.master) this.master.gain.value = v; }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.engGain, this.abGain, this.windGain, this.gunGain, this.toneGain, this.warnGain, this.rwrGain]) g.gain.setTargetAtTime(0, t, 0.05);
  }

  update(dt: number, s: {
    rpm: number; ab: number; qbar: number; gun: boolean; tone: 'off' | 'search' | 'lock';
    rwr: 'none' | 'search' | 'lock' | 'launch'; warn: boolean; cockpit: boolean; alive: boolean;
  }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tc = 0.08;
    const inside = s.cockpit ? 0.55 : 1;
    this.engGain.gain.setTargetAtTime(s.alive ? 0.12 * (s.rpm / 100) * inside : 0, t, tc);
    this.engFilter.frequency.setTargetAtTime(200 + s.rpm * 9, t, tc);
    this.engOsc.frequency.setTargetAtTime(80 + s.rpm * 6, t, tc);
    this.abGain.gain.setTargetAtTime(s.alive ? 0.35 * s.ab * inside : 0, t, tc);
    const wind = Math.min(1, s.qbar / 40000);
    this.windGain.gain.setTargetAtTime(0.25 * wind, t, tc);
    this.windFilter.frequency.setTargetAtTime(500 + wind * 1500, t, tc);
    this.gunGain.gain.setTargetAtTime(s.gun ? 0.45 : 0, t, 0.02);
    if (s.tone === 'off') this.toneGain.gain.setTargetAtTime(0, t, 0.03);
    else {
      this.toneGain.gain.setTargetAtTime(0.06, t, 0.03);
      this.toneOsc.frequency.setTargetAtTime(s.tone === 'lock' ? 1250 : 480, t, 0.03);
      this.toneLfoGain.gain.setTargetAtTime(s.tone === 'lock' ? 15 : 140, t, 0.03);
    }
    this.beepTimer += dt;
    let rwrOn = false;
    if (s.rwr === 'launch') rwrOn = (this.beepTimer * 8) % 1 < 0.5;
    else if (s.rwr === 'lock') rwrOn = (this.beepTimer * 2) % 1 < 0.25;
    this.rwrGain.gain.setTargetAtTime(rwrOn ? 0.05 : 0, t, 0.01);
    const warnOn = s.warn && (this.beepTimer * 3) % 1 < 0.5;
    this.warnGain.gain.setTargetAtTime(warnOn ? 0.04 : 0, t, 0.01);
  }

  boom(distance: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = Math.min(0.8, 600 / Math.max(distance, 300));
    s.connect(f).connect(g).connect(this.master);
    s.start(ctx.currentTime + Math.min(distance / 340, 6));
  }
}
