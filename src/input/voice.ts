// Push-to-talk voice commands via the browser's Web Speech API. Off by default (Settings → Voice commands): in Chrome
// and Edge the recogniser streams the microphone audio to the browser vendor's speech service, so it only runs while
// the push-to-talk key is held/pressed and only after the player opted in. Results go through comms.matchCommand.

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recogniserCtor(): (new () => Rec) | null {
  const w = globalThis as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceInput {
  private rec: Rec | null = null;
  listening = false;
  /** called with the recogniser's alternatives (best first) */
  onPhrase: (alternatives: string[]) => void = () => {};
  /** status lines for the radio log (listening, errors) */
  onStatus: (text: string) => void = () => {};

  static supported() { return recogniserCtor() !== null; }

  /** start listening for one phrase (push-to-talk press) */
  start() {
    const Ctor = recogniserCtor();
    if (!Ctor) { this.onStatus('Voice commands are not supported in this browser — use the comms menu (\\).'); return; }
    if (this.listening) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 4;
    rec.onresult = (e) => {
      const r = e.results[0];
      const alts: string[] = [];
      for (let i = 0; i < r.length; i++) alts.push(r[i].transcript);
      this.onPhrase(alts);
    };
    rec.onerror = (e) => {
      const why: Record<string, string> = {
        'not-allowed': 'microphone permission denied',
        'service-not-allowed': 'speech service not available here',
        network: 'speech service unreachable (offline, or not available in the desktop app)',
        'no-speech': 'nothing heard',
      };
      this.onStatus(`Voice: ${why[e.error] ?? e.error} — the comms menu (\\) always works.`);
    };
    rec.onend = () => { this.listening = false; this.rec = null; };
    this.rec = rec;
    this.listening = true;
    try { rec.start(); this.onStatus('🎙 Listening…'); } catch { this.listening = false; this.rec = null; }
  }

  stop() { this.rec?.stop(); }
  dispose() { this.rec?.abort(); this.rec = null; this.listening = false; }
}
