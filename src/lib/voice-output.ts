// Spoken replies (chrome.tts) and short sounds ("earcons") for wake/sleep/error.

export class Speaker {
  private speakingUntil = 0;
  private speaking = false;
  private utterance = 0;

  constructor(private readonly getVoice: () => { rate: number; voiceName: string; lang: string }) {}

  /** True while speaking and briefly after, so the mic doesn't hear Navi's own voice as a command. */
  get busy(): boolean {
    return this.speaking || Date.now() < this.speakingUntil;
  }

  /** Skips speech entirely (used by the benchmark runner). */
  muted = false;

  say(text: string): Promise<void> {
    const clean = text.replace(/[*_`#>]/g, "").trim();
    if (!clean || this.muted) return Promise.resolve();
    const { rate, voiceName, lang } = this.getVoice();
    const id = ++this.utterance;
    this.speaking = true;
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        // A newer utterance may have started; only the latest one controls the flag.
        if (id === this.utterance) {
          this.speaking = false;
          this.speakingUntil = Date.now() + 700;
        }
        resolve();
      };
      chrome.tts.speak(clean, {
        rate,
        lang,
        voiceName: voiceName || undefined,
        enqueue: false,
        onEvent: (event) => {
          if (["end", "interrupted", "cancelled", "error"].includes(event.type)) done();
        },
      });
      // Safety net in case no end event arrives.
      window.setTimeout(done, 1000 + clean.length * 120);
    });
  }

  stop() {
    chrome.tts.stop();
    this.speaking = false;
  }
}

let audio: AudioContext | null = null;

function tone(freq: number, start: number, duration: number, volume = 0.08) {
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = audio.currentTime + start;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const earcons = {
  wake() {
    tone(660, 0, 0.12);
    tone(990, 0.09, 0.16);
  },
  sleep() {
    tone(880, 0, 0.12);
    tone(587, 0.09, 0.18);
  },
  error() {
    tone(220, 0, 0.18, 0.1);
  },
  done() {
    tone(1175, 0, 0.08, 0.05);
  },
  /** Soft tick when a command goes to the AI, so you know Navi heard you. */
  thinking() {
    tone(784, 0, 0.06, 0.04);
  },
};
