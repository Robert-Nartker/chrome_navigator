// Navi's ears and voice: the microphone, speech recognition (Chrome's on-device recognizer), the
// "Hey Navi" session, and spoken replies and sounds. It runs in Navi's
// background page (an offscreen document), so Navi keeps listening with the side panel closed.
// It knows nothing about commands: finished commands go out through `EarsOutput`.

import type { EarsState, LogKind } from "../lib/messages";
import { WakeSession } from "../lib/session";
import { DEFAULT_SETTINGS, type Settings, naviVoiceOf } from "../lib/settings";
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
  /** Dictation for the chat box: words heard so far, then the finished phrase. */
  dictation(text: string, final: boolean): void;
}

const STOP_WORDS = /\b(stop|cancel|quiet)\b/i;
/** A short "stop" on its own: stops whatever Navi is doing, even asleep and without the name. */
const JUST_STOP = /^(?:(?:hey |ok(?:ay)? )?(?:navi|navy)[,.]? )?(?:stop|stop it|stop that|cancel|never ?mind|quiet|be quiet|shut up)[.!]*$/i;
/** How long what Navi heard while asleep stays on screen. */
const HEARD_MS = 6000;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

/** Navi hearing its own voice: most of the words are in what it's saying. */
export function isEcho(heard: string, saying: string): boolean {
  const said = new Set(words(saying));
  const h = words(heard);
  if (!h.length) return true;
  return h.filter((w) => said.has(w)).length / h.length >= 0.6;
}
/** Dictation ends by itself after this long without hearing anything. */
const DICTATION_IDLE_MS = 8000;

export class Ears {
  private settings: Settings = DEFAULT_SETTINGS;
  /** Chrome's on-device recognizer: always on while listening. */
  private engine: SpeechEngine | null = null;
  private micError = "";
  private chromeLabel = "";
  private lastInfo = "";
  private lastState = "";
  private listenGeneration = 0;
  private wasAwake = false;
  readonly session = new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 });
  readonly speaker: Speaker;
  private lastVoiceError = "";
  /** Dictating into the chat box: the next phrase is typed there instead of run. */
  private dictating = false;
  /** The mic was off, so it was turned on just to dictate. */
  private dictationOnly = false;
  private dictationTimer: ReturnType<typeof setTimeout> | undefined;
  private heardAsleep = "";
  private heardAt = 0;

  constructor(private readonly out: EarsOutput) {
    this.speaker = new Speaker(
      () => ({
        rate: this.settings.speechRate,
        voiceName: this.settings.voiceName,
        lang: this.settings.lang,
        volume: this.settings.volume,
        neural: naviVoiceOf(this.settings),
      }),
      (message) => {
        if (message !== this.lastVoiceError) this.out.log("error", `Voice: ${message} Using Chrome's voice.`);
        this.lastVoiceError = message;
      },
      (note) => this.out.log("info", note),
    );
    setInterval(() => this.tick(), 1000);
  }

  get listening(): boolean {
    return !!this.engine?.running;
  }

  configure(next: Settings) {
    const restart =
      this.listening &&
      (next.lang !== this.settings.lang || next.wakeName !== this.settings.wakeName || next.listenMode !== this.settings.listenMode);
    if (next.speechOutput !== this.settings.speechOutput || next.naviVoice !== this.settings.naviVoice) this.lastVoiceError = "";
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

  /** Dictates one phrase into the chat box (turning the mic on for it if it's off), or stops. */
  async dictate(on: boolean) {
    clearTimeout(this.dictationTimer);
    if (on) {
      this.speaker.stop();
      if (!this.dictating) {
        this.dictating = true;
        this.dictationOnly = !this.listening;
        if (this.dictationOnly) await this.start();
      }
      this.dictationTimer = setTimeout(() => void this.dictate(false), DICTATION_IDLE_MS);
    } else if (this.dictating) {
      this.dictating = false;
      if (this.dictationOnly) this.stop();
      this.dictationOnly = false;
    }
    this.emit();
  }

  /** Awake without the name (the keyboard shortcut): listening for a command now. */
  wake() {
    if (this.session.current === "awake") return this.touch();
    this.session.wake();
    this.wasAwake = true;
    earcons.wake();
    this.emit();
  }

  /** "Go to sleep" (hands-free): back to waiting for the name. */
  sleep() {
    this.session.sleep();
    this.wasAwake = false;
    earcons.sleep();
    this.emit();
  }

  /** Keeps the session awake while a command runs. */
  touch() {
    this.session.touch();
  }

  /** A finished phrase from the recognizer (also used by tests). */
  final(transcript: string, confidence = 0) {
    this.out.interim("");
    if (this.dictating) {
      this.out.dictation(transcript, true);
      void this.dictate(false);
      return;
    }
    if (this.speaker.busy) {
      // Navi's own voice coming back through the mic: not a command.
      if (isEcho(transcript, this.speaker.lastSaid)) return;
      if (STOP_WORDS.test(transcript)) return this.out.cancel();
      // Talking over Navi: it stops and listens.
      this.speaker.stop();
    }
    if (JUST_STOP.test(transcript.trim())) {
      // "Stop" works any time, with or without the name: it halts speech and any running task.
      this.out.cancel();
      return;
    }
    const decision = this.session.handle(transcript);
    if (decision.woke) {
      earcons.wake();
      this.wasAwake = true;
    }
    if (decision.command) this.out.command(decision.command, confidence);
    // Asleep and not for Navi: show what was heard for a moment, so a missed "Hey Navi" is visible.
    const asleep = this.settings.listenMode === "handsfree" && this.session.current === "sleeping";
    this.heardAsleep = asleep && !decision.woke ? transcript : "";
    this.heardAt = Date.now();
    this.emit();
  }

  get state(): EarsState {
    return {
      listening: this.listening,
      awake: this.listening && this.session.current === "awake",
      micError: this.micError,
      engineLabel: this.listening ? this.chromeLabel : "",
      voiceLabel: this.speaker.lastVoice,
      remainingMs: this.listening && this.settings.listenMode === "handsfree" ? this.session.remainingMs : 0,
      speaking: this.speaker.busy,
      dictating: this.dictating,
      heardAsleep: this.heardAsleep || undefined,
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
    if (this.heardAsleep && Date.now() - this.heardAt > HEARD_MS) this.heardAsleep = "";
    // Detect the session timing out on its own.
    const awake = this.session.current === "awake";
    if (this.wasAwake && !awake && this.settings.listenMode === "handsfree" && this.listening) {
      earcons.sleep();
    }
    this.wasAwake = awake;
    if (this.listening && this.settings.listenMode === "handsfree") this.out.state(this.state);
    else this.emit();
  }

  private interim(text: string) {
    if (this.dictating) {
      this.out.dictation(text, false);
      // Still talking: keep dictating.
      clearTimeout(this.dictationTimer);
      this.dictationTimer = setTimeout(() => void this.dictate(false), DICTATION_IDLE_MS);
      return;
    }
    if (this.speaker.busy) {
      // Someone talking over Navi (not its own voice): stop speaking right away and show what's heard.
      if (words(text).length < 2 || isEcho(text, this.speaker.lastSaid)) return;
      this.speaker.stop();
    }
    const asleep = this.settings.listenMode === "handsfree" && this.session.current === "sleeping";
    // While asleep, only show speech once the wake word is heard (nothing else is acted on).
    this.out.interim(asleep && !this.session.hearsWakePhrase(text) ? "" : text);
  }

  private buildEngine(): SpeechEngine {
    // No word boosting: it made Chrome "hear" boosted words in background noise.
    return new WebSpeechEngine(
      { lang: this.settings.lang },
      {
        onInterim: (text) => this.interim(text),
        onFinal: (text, confidence) => this.final(text, confidence),
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
    this.micError =
      /microphone access is blocked/i.test(message) && (await micGranted())
        ? "This version of Chrome can't listen in the background. Update Chrome."
        : message;
    this.out.log("error", this.micError);
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
    this.engine?.stop();
    this.engine = null;
    const next = this.buildEngine();
    this.engine = next;
    await next.start();
    // A newer start or a stop happened meanwhile: never leave two recognizers running.
    if (generation !== this.listenGeneration) {
      next.stop();
      return;
    }
    if (this.settings.listenMode === "open") this.session.wake();
    // Load Navi's voice now, so the first reply isn't in the fallback voice while it loads.
    if (naviVoiceOf(this.settings)) void this.speaker.prepareVoice().catch(() => undefined);
    this.emit();
  }

  private stop() {
    this.listenGeneration++;
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
