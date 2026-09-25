// Navi's ears and voice: the microphone, speech recognition (Chrome's recognizer, plus ElevenLabs while
// awake when a key is set), the "Hey Navi" session, and spoken replies and sounds. It runs in Navi's
// background page (an offscreen document), so Navi keeps listening with the side panel closed.
// It knows nothing about commands: finished commands go out through `EarsOutput`.

import type { EarsState, LogKind } from "../lib/messages";
import { ScribeEngine } from "../lib/scribe";
import { WakeSession } from "../lib/session";
import { DEFAULT_SETTINGS, type Settings, usesElevenInput, usesElevenOutput } from "../lib/settings";
import { type SpeechEngine, WebSpeechEngine, speechSupported } from "../lib/speech";
import { type EarconName, Speaker, earcons, setSoundVolume } from "../lib/voice-output";

export interface EarsOutput {
  /** A command to run (the wake word is already handled). */
  command(text: string, confidence: number): void;
  /** "Stop" heard while Navi was talking. */
  cancel(): void;
  state(state: EarsState): void;
  /** What the recognizer is hearing right now ("" to clear). */
  interim(text: string): void;
  log(kind: Extract<LogKind, "info" | "error">, text: string): void;
}

const STOP_WORDS = /\b(stop|cancel|quiet)\b/i;

export class Ears {
  private settings: Settings = DEFAULT_SETTINGS;
  /** Chrome's recognizer: always on while listening (wake word, "stop" during replies, fallback). */
  private engine: SpeechEngine | null = null;
  /** ElevenLabs Scribe: transcribes commands while awake, when a key is set. */
  private scribe: ScribeEngine | null = null;
  /** ElevenLabs failed for good (bad key, quota); stay on Chrome's recognizer until settings change. */
  private scribeDisabled = false;
  /** Chrome refused to recognize speech here (older Chrome in a background page): ElevenLabs does it all. */
  private chromeBlocked = false;
  private micError = "";
  private chromeLabel = "";
  private lastInfo = "";
  private lastState = "";
  private listenGeneration = 0;
  private wasAwake = false;
  readonly session = new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 });
  readonly speaker: Speaker;
  private lastVoiceError = "";

  constructor(private readonly out: EarsOutput) {
    this.speaker = new Speaker(
      () => ({
        rate: this.settings.speechRate,
        voiceName: this.settings.voiceName,
        lang: this.settings.lang,
        volume: this.settings.volume,
        eleven: usesElevenOutput(this.settings)
          ? { apiKey: this.settings.elevenLabsKey, voiceId: this.settings.elevenVoiceId, model: this.settings.elevenModel }
          : undefined,
      }),
      (message) => {
        if (message !== this.lastVoiceError) this.out.log("error", `Voice: ${message} Using Chrome's voice.`);
        this.lastVoiceError = message;
      },
    );
    setInterval(() => this.tick(), 1000);
  }

  get listening(): boolean {
    return !!this.engine?.running || (this.chromeBlocked && !!this.scribe?.running);
  }

  get scribeLive(): boolean {
    return !!this.scribe?.live;
  }

  configure(next: Settings) {
    const speechChanged =
      next.elevenLabsKey !== this.settings.elevenLabsKey ||
      next.speechInput !== this.settings.speechInput ||
      next.filterBackgroundAudio !== this.settings.filterBackgroundAudio;
    const restart =
      this.listening &&
      (speechChanged ||
        next.lang !== this.settings.lang ||
        next.wakeName !== this.settings.wakeName ||
        next.allowCloudSpeech !== this.settings.allowCloudSpeech ||
        next.listenMode !== this.settings.listenMode);
    if (speechChanged) this.scribeDisabled = false;
    if (next.elevenLabsKey !== this.settings.elevenLabsKey || next.elevenVoiceId !== this.settings.elevenVoiceId) {
      this.lastVoiceError = "";
    }
    this.settings = next;
    setSoundVolume(next.volume);
    this.session.configure({ mode: next.listenMode, wakeName: next.wakeName, timeoutSec: next.sessionTimeoutSec });
    if (restart) void this.start();
    this.emit();
  }

  async listen(on: boolean) {
    if (on) await this.start();
    else this.stop();
  }

  say(text: string) {
    return this.speaker.say(text);
  }

  stopSpeaking() {
    this.speaker.stop();
  }

  sound(name: EarconName) {
    earcons[name]();
  }

  /** "Go to sleep" (hands-free): back to waiting for the name. */
  sleep() {
    this.session.sleep();
    this.wasAwake = false;
    this.stopScribe();
    earcons.sleep();
    this.emit();
  }

  /** Keeps the session awake while a command runs. */
  touch() {
    this.session.touch();
  }

  /** A finished phrase from whichever recognizer is transcribing (also used by tests). */
  final(transcript: string, confidence = 0) {
    this.out.interim("");
    if (this.speaker.busy) {
      // Let "stop" interrupt a long reply; ignore anything else (likely Navi's own voice).
      if (STOP_WORDS.test(transcript)) this.out.cancel();
      return;
    }
    const decision = this.session.handle(transcript);
    if (decision.woke) {
      earcons.wake();
      this.wasAwake = true;
      this.startScribe();
    }
    if (decision.command) this.out.command(decision.command, confidence);
    this.emit();
  }

  /** Chrome's recognizer defers to ElevenLabs while it's active, except to hear "stop" during a reply. */
  chromeFinal(transcript: string, confidence: number) {
    if (!this.scribeLive) return this.final(transcript, confidence);
    if (this.speaker.busy && STOP_WORDS.test(transcript)) this.out.cancel();
  }

  /** Feeds ElevenLabs a tone at the given level for n x 100 ms, as if someone were talking (tests). */
  feedScribe(level: number, chunks: number) {
    for (let i = 0; i < chunks; i++) {
      this.scribe?.feed(Float32Array.from({ length: 1600 }, (_, j) => level * Math.sin((2 * Math.PI * 220 * j) / 16000)));
    }
  }

  get state(): EarsState {
    const eleven = this.scribeLive
      ? `ElevenLabs${this.settings.filterBackgroundAudio ? " · ignores background voices" : ""}`
      : "";
    return {
      listening: this.listening,
      awake: this.listening && this.session.current === "awake",
      micError: this.micError,
      engineLabel: this.listening ? eleven || this.chromeLabel : "",
      remainingMs: this.listening && this.settings.listenMode === "handsfree" ? this.session.remainingMs : 0,
      speaking: this.speaker.busy,
    };
  }

  private emit() {
    const state = this.state;
    // remainingMs changes every tick; send it at most once a second (from tick) unless something else changed.
    const key = JSON.stringify({ ...state, remainingMs: 0 });
    if (key !== this.lastState) {
      this.lastState = key;
      this.out.state(state);
    }
  }

  private tick() {
    // Detect the session timing out on its own.
    const awake = this.session.current === "awake";
    if (this.wasAwake && !awake && this.settings.listenMode === "handsfree" && this.listening) {
      earcons.sleep();
      this.stopScribe();
    }
    this.wasAwake = awake;
    if (this.listening && this.settings.listenMode === "handsfree") this.out.state(this.state);
    else this.emit();
  }

  private interim(text: string) {
    if (this.speaker.busy) return;
    const asleep = this.settings.listenMode === "handsfree" && this.session.current === "sleeping";
    // While asleep, only show speech once the wake word is heard (nothing else is acted on).
    this.out.interim(asleep && !this.session.hearsWakePhrase(text) ? "" : text);
  }

  private buildEngine(): SpeechEngine {
    // No word boosting: it made Chrome "hear" boosted words in background noise.
    return new WebSpeechEngine(
      { lang: this.settings.lang, preferOnDevice: true, allowCloud: this.settings.allowCloudSpeech },
      {
        onInterim: (text) => {
          if (!this.scribeLive) this.interim(text);
        },
        onFinal: (text, confidence) => this.chromeFinal(text, confidence),
        onRunningChange: () => this.emit(),
        onError: (message, fatal) => void this.onChromeError(message, fatal),
        onInfo: (message) => {
          if (message.startsWith("Speech: ")) {
            this.chromeLabel = message.slice("Speech: ".length).replace(/^Chrome speech/, "Chrome");
            this.emit();
            return;
          }
          // Restarts (e.g. after a settings change) repeat the same notes; show each once.
          if (message !== this.lastInfo) this.out.log("info", message);
          this.lastInfo = message;
        },
      },
    );
  }

  private async onChromeError(message: string, fatal: boolean) {
    if (!fatal) {
      this.out.log("error", message);
      this.emit();
      return;
    }
    this.engine = null;
    // The mic works but Chrome won't recognize speech in a background page (Chrome before ~150).
    if (/microphone access is blocked/i.test(message) && (await micGranted())) {
      this.chromeBlocked = true;
      if (usesElevenInput(this.settings) && !this.scribeDisabled) {
        this.out.log("info", "This version of Chrome can't recognize speech in the background, so ElevenLabs listens instead.");
        this.startScribe();
      } else {
        this.micError = "This version of Chrome can't listen in the background. Update Chrome, or add an ElevenLabs key in settings.";
        this.out.log("error", this.micError);
      }
    } else {
      this.micError = message;
      this.out.log("error", message);
    }
    this.emit();
  }

  /** Starts ElevenLabs for an awake session (or for everything when Chrome can't recognize here). */
  private startScribe() {
    if (this.scribe || this.scribeDisabled || !usesElevenInput(this.settings)) return;
    if (!this.engine?.running && !this.chromeBlocked) return;
    // Just the wake name: a long list of boosted words risks phantom words.
    const keyterms = [this.settings.wakeName, `Hey ${this.settings.wakeName}`];
    let lastError = "";
    const current = new ScribeEngine(
      {
        apiKey: this.settings.elevenLabsKey,
        lang: this.settings.lang,
        keyterms,
        filterBackgroundAudio: this.settings.filterBackgroundAudio,
        isMuted: () => this.speaker.busy,
      },
      {
        onInterim: (text) => this.interim(text),
        onFinal: (text, confidence) => this.final(text, confidence),
        onRunningChange: () => this.emit(),
        onError: (message, fatal) => {
          // With Chrome's recognizer blocked here, losing ElevenLabs means Navi can't hear at all.
          const fallback = this.chromeBlocked
            ? "This version of Chrome can't listen in the background, so the mic is off. Check your ElevenLabs key, or update Chrome."
            : "Using Chrome's speech recognition.";
          if (message !== lastError) this.out.log("error", fatal ? `${message} ${fallback}` : message);
          lastError = message;
          if (fatal) {
            this.scribeDisabled = true;
            if (this.scribe === current) this.scribe = null;
            current.stop();
            if (this.chromeBlocked) this.micError = fallback;
          }
          this.emit();
        },
      },
    );
    this.scribe = current;
    void current.start();
  }

  private stopScribe() {
    // When ElevenLabs is the only recognizer, it keeps listening for the name while asleep.
    if (this.chromeBlocked && this.listening) return;
    this.scribe?.stop();
    this.scribe = null;
    this.emit();
  }

  private async start() {
    if (!speechSupported()) {
      this.micError = "Speech recognition isn't available in this browser.";
      this.out.log("error", this.micError);
      this.emit();
      return;
    }
    this.micError = "";
    const generation = ++this.listenGeneration;
    this.scribe?.stop();
    this.scribe = null;
    this.engine?.stop();
    this.engine = null;
    if (!this.chromeBlocked) {
      const next = this.buildEngine();
      this.engine = next;
      await next.start();
      // A newer start or a stop happened meanwhile: never leave two recognizers running.
      if (generation !== this.listenGeneration) {
        next.stop();
        return;
      }
    }
    if (this.settings.listenMode === "open") this.session.wake();
    if (this.chromeBlocked || this.settings.listenMode === "open" || this.session.current === "awake") this.startScribe();
    this.emit();
  }

  private stop() {
    this.listenGeneration++;
    this.scribe?.stop();
    this.scribe = null;
    this.engine?.stop();
    this.engine = null;
    this.out.interim("");
    this.emit();
  }
}

async function micGranted(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state === "granted";
  } catch {
    return false;
  }
}
