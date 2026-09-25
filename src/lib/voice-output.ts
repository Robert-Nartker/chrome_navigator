// Spoken replies (chrome.tts) and short sounds ("earcons") for wake/sleep/error.

/**
 * One voice everywhere: Chrome's built-in "Google US English" is the same voice on
 * macOS and Windows. Others are fallbacks only if Chrome doesn't offer it.
 */
const PREFERRED_VOICES = [/^Google US English$/i, /Aria.*Natural/i, /^Samantha/i, /Zira/i];

let voicesPromise: Promise<chrome.tts.TtsVoice[]> | null = null;

export function listVoices(): Promise<chrome.tts.TtsVoice[]> {
  voicesPromise ??= new Promise((resolve) => chrome.tts.getVoices((voices) => resolve(voices ?? [])));
  return voicesPromise;
}

/** Picks the most pleasant available voice for the language. */
export async function pickVoice(lang: string): Promise<string | undefined> {
  const voices = (await listVoices()).filter((v) => !v.lang || v.lang.startsWith(lang.slice(0, 2)));
  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((v) => v.voiceName && pattern.test(v.voiceName));
    if (match) return match.voiceName;
  }
  return voices.find((v) => v.gender === "female")?.voiceName ?? voices[0]?.voiceName;
}

export interface VoiceSettings {
  rate: number;
  voiceName: string;
  lang: string;
  volume: number;
}

export class Speaker {
  private speakingUntil = 0;
  private speaking = false;
  private utterance = 0;

  constructor(private readonly getVoice: () => VoiceSettings) {}

  /** True while speaking and briefly after, so the mic doesn't hear Navi's own voice as a command. */
  get busy(): boolean {
    return this.speaking || Date.now() < this.speakingUntil;
  }

  /** Skips speech entirely (used by the benchmark runner). */
  muted = false;

  async say(text: string): Promise<void> {
    const clean = text.replace(/[*_`#>]/g, "").trim();
    if (!clean || this.muted) return;
    const { rate, lang, volume } = this.getVoice();
    const id = ++this.utterance;
    this.speaking = true;
    const voiceName = this.getVoice().voiceName || (await pickVoice(lang));
    if (id !== this.utterance) return;
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
        volume,
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
let masterVolume = 0.6;

/** Scales the sound effects with the user's volume setting. */
export function setSoundVolume(volume: number) {
  masterVolume = volume;
}

function tone(freq: number, start: number, duration: number, level = 0.08) {
  const volume = level * masterVolume;
  if (volume <= 0) return;
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
    tone(330, 0, 0.12, 0.07);
    tone(262, 0.1, 0.16, 0.07);
  },
  /** Soft "didn't catch that" (heard speech, but it wasn't a command). */
  unknown() {
    tone(523, 0, 0.09, 0.05);
    tone(440, 0.08, 0.12, 0.05);
  },
  done() {
    tone(1175, 0, 0.08, 0.05);
  },
  /** Soft tick when a command goes to the AI, so you know Navi heard you. */
  thinking() {
    tone(784, 0, 0.06, 0.04);
  },
};
