// Navi's ears and voice: the microphone, speech recognition (Chrome's on-device recognizer, or Parakeet
// when chosen), the "Hey Navi" session, and spoken replies and sounds. It runs in Navi's background page
// (an offscreen document), so Navi keeps listening with the side panel closed.
// It knows nothing about commands: finished commands go out through `EarsOutput`.

import type { EarsState, LogKind } from "../lib/messages";
import { WakeSession } from "../lib/session";
import { DEFAULT_SETTINGS, type Settings, naviVoiceOf } from "../lib/settings";
import { type SpeechCallbacks, type SpeechEngine, WebSpeechEngine, speechSupported } from "../lib/speech";
import { type EarconName, Speaker, earcons, setSoundVolume } from "../lib/voice-output";
import type * as ParakeetModule from "../voice/parakeet";
import { parakeetModelFor } from "../voice/parakeet-langs";
import { loadModule } from "../lib/load-module";
import { parseCommand } from "../lib/parser";

export interface EarsOutput {
  /** A command to run (the wake word is already handled), and the recognizer's other guesses at it. */
  command(text: string, confidence: number, alternatives: string[]): void;
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
/** After Parakeet fails to load, Navi tries again this much later. */
const PARAKEET_RETRY_MS = 10 * 60_000;

export class Ears {
  private settings: Settings = DEFAULT_SETTINGS;
  /** The recognizer while listening: Chrome's, or Parakeet once it's loaded (if chosen). */
  private engine: SpeechEngine | null = null;
  /** Parakeet, loaded and kept between mic sessions while it's the chosen recognizer. */
  private parakeet: ParakeetModule.ParakeetEngine | null = null;
  private parakeetLoading = false;
  private parakeetProgress = "";
  private parakeetRetryAt = 0;
  /** Tests: stands in for Parakeet's model. */
  fakeParakeet: ParakeetModule.FakeModel | undefined;
  /** The mic should be on (even while a recognizer is between starts). */
  private wantListening = false;
  private micError = "";
  private engineLabel = "";
  private lastInfo = "";
  private lastState = "";
  private listenGeneration = 0;
  private wasAwake = false;
  readonly session = new WakeSession({
    mode: DEFAULT_SETTINGS.listenMode,
    wakeName: DEFAULT_SETTINGS.wakeName,
    timeoutSec: DEFAULT_SETTINGS.sessionTimeoutSec,
  });
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
        if (message !== this.lastVoiceError) this.out.log("error", `Voice: ${message.replace(/[.!]?$/, ".")} Using Chrome's voice.`);
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
      (next.lang !== this.settings.lang ||
        next.wakeName !== this.settings.wakeName ||
        next.listenMode !== this.settings.listenMode ||
        next.recognizer !== this.settings.recognizer ||
        next.micDeviceId !== this.settings.micDeviceId);
    if (next.speechOutput !== this.settings.speechOutput || next.naviVoice !== this.settings.naviVoice) this.lastVoiceError = "";
    // Parakeet was turned off (or hears another language now): free its memory.
    if (this.parakeet && (next.recognizer !== "parakeet" || next.lang !== this.settings.lang)) {
      this.parakeet.dispose();
      this.parakeet = null;
    }
    // Chosen again: try loading it right away.
    if (next.recognizer === "parakeet" && this.settings.recognizer !== "parakeet") this.parakeetRetryAt = 0;
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
      else if (this.parakeet && this.engine !== this.parakeet && this.wantsParakeet()) void this.start();
      this.dictationOnly = false;
    }
    this.emit();
  }

  /** Awake without the name (the keyboard shortcut): listening for a command now. Push to talk opens the mic. */
  async wake() {
    if (this.settings.listenMode === "push" && !this.listening) await this.start();
    if (this.session.current === "awake") return this.touch();
    this.session.wake();
    this.wasAwake = true;
    earcons.wake();
    this.warmVoice();
    this.emit();
  }

  /** "Go to sleep" (hands-free): back to waiting for the name. Push to talk closes the mic. */
  sleep() {
    this.session.sleep();
    this.wasAwake = false;
    earcons.sleep();
    if (this.settings.listenMode === "push" && this.listening && !this.dictating) this.stop();
    this.emit();
  }

  /** Keeps the session awake while a command runs. */
  touch() {
    this.session.touch();
  }

  /** A finished phrase from the recognizer (also used by tests). */
  final(transcript: string, confidence = 0, alternatives: string[] = []) {
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
      this.warmVoice();
    } else if (decision.named && !decision.command) {
      // "Hey Navi" while already awake (or in open mic): a sound says it heard.
      earcons.wake();
    }
    if (decision.command) {
      const others = alternatives.map((a) => this.session.withoutName(a)).filter((a) => a && a !== decision.command);
      this.out.command(decision.command, confidence, others);
    }
    // Asleep and not for Navi: show what was heard for a moment, so a missed "Hey Navi" is visible.
    this.heardAsleep = this.asleep && !decision.woke ? transcript : "";
    this.heardAt = Date.now();
    this.emit();
  }

  /** Woken: Navi's voice (unloaded when idle) starts loading, so the reply is in it. */
  private warmVoice() {
    if (naviVoiceOf(this.settings)) void this.speaker.prepareVoice().catch(() => undefined);
  }

  /** Waiting for the wake name (hands-free mode only). */
  private get asleep(): boolean {
    return this.settings.listenMode === "handsfree" && this.session.current === "sleeping";
  }

  get state(): EarsState {
    return {
      listening: this.listening,
      awake: this.listening && this.session.current === "awake",
      micError: this.micError,
      engineLabel: this.listening ? this.engineLabel + (this.parakeetProgress ? ` · Parakeet ${this.parakeetProgress}` : "") : "",
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
    // Push to talk: the mic stays open while Navi answers and for a few quiet seconds after, then closes.
    if (this.settings.listenMode === "push" && this.listening && !this.dictating) {
      if (this.speaker.busy) this.session.touch();
      else if (this.session.current !== "awake") {
        this.wasAwake = false;
        earcons.sleep();
        this.stop();
        return;
      }
    }
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
    // While asleep, nothing is shown or acted on until the name is heard. Hearing it wakes Navi right
    // away, without waiting for the recognizer to finish the phrase.
    if (this.asleep && this.session.hearsWakePhrase(text) && this.session.wakeMidPhrase()) {
      earcons.wake();
      this.wasAwake = true;
      this.warmVoice();
      this.heardAsleep = "";
      this.emit();
    }
    // The caption shows the command, not the name in front of it.
    this.out.interim(this.asleep ? "" : this.session.withoutName(text) || text);
  }

  /** What either recognizer reports to. */
  private readonly callbacks: SpeechCallbacks = {
    onInterim: (text) => this.interim(text),
    onFinal: (text, confidence, alternatives) => this.final(text, confidence, alternatives),
    onRunningChange: () => this.emit(),
    onError: (message, fatal) => void this.onEngineError(message, fatal),
    onInfo: (message) => {
      if (message.startsWith("Speech: ")) {
        this.engineLabel = message.slice("Speech: ".length).replace(/^Chrome speech/, "Chrome");
        this.emit();
        return;
      }
      // Restarts (e.g. after a settings change) repeat the same notes; show each once.
      if (message !== this.lastInfo) this.out.log("info", message);
      this.lastInfo = message;
    },
  };

  private wantsParakeet(): boolean {
    return this.settings.recognizer === "parakeet" && !!parakeetModelFor(this.settings.lang);
  }

  /**
   * Loads Parakeet (downloading it the first time) while Chrome's recognizer listens, then swaps it in.
   * Its libraries are a separate module, loaded only here.
   */
  private async loadParakeet() {
    if (this.parakeet || this.parakeetLoading || Date.now() < this.parakeetRetryAt) return;
    const lang = this.settings.lang;
    this.parakeetLoading = true;
    this.parakeetProgress = "loading";
    this.emit();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const mod = await loadModule<typeof ParakeetModule>("voice/parakeet.js");
      const engine = await mod.createParakeetEngine(lang, this.callbacks, {
        // Asleep, Navi only needs finished phrases (to catch its name): no live captions to compute.
        live: () => this.dictating || this.session.current === "awake",
        deviceId: () => this.settings.micDeviceId,
        fake: this.fakeParakeet,
      });
      let noted = false;
      timer = setTimeout(() => {
        noted = true;
        this.out.log("info", `Downloading Parakeet (once, about ${engine.downloadGb} GB). Chrome's recognizer listens until it's ready.`);
      }, 1500);
      let shown = -1;
      await engine.load((loaded, total) => {
        const pct = total ? Math.floor((loaded / total) * 100) : 0;
        if (pct === shown) return;
        shown = pct;
        this.parakeetProgress = `${pct}%`;
        this.emit();
      });
      if (!this.wantsParakeet() || this.settings.lang !== lang) return engine.dispose();
      this.parakeet = engine;
      if (noted) this.out.log("info", "Parakeet is ready, and listening from now on.");
      // Swap it in for Chrome's recognizer (after any dictation in progress).
      if (this.wantListening && !this.dictating) void this.start();
    } catch (err) {
      this.parakeetRetryAt = Date.now() + PARAKEET_RETRY_MS;
      const why = err instanceof Error ? err.message : String(err);
      this.out.log("error", `Parakeet couldn't load (${why}), so Chrome's recognizer is listening. Navi tries again later.`);
    } finally {
      clearTimeout(timer);
      this.parakeetLoading = false;
      this.parakeetProgress = "";
      this.emit();
    }
  }

  private chromeEngine(): SpeechEngine {
    // No word boosting: it made Chrome "hear" boosted words in background noise.
    return new WebSpeechEngine(
      { lang: this.settings.lang, deviceId: this.settings.micDeviceId, endOfPhraseMs: (text) => this.phraseEndMs(text) },
      this.callbacks,
    );
  }

  /**
   * How long to wait for more words after Chrome finishes a piece of a phrase: a moment if it's already
   * a whole command ("close tab"), longer if not ("search for", "8"), longest while dictating a message.
   */
  private phraseEndMs(text: string): number {
    if (this.dictating) return 900;
    const command = this.session.withoutName(text);
    return command && parseCommand(command) ? 200 : 600;
  }

  private async onEngineError(message: string, fatal: boolean) {
    if (!fatal) {
      this.out.log("error", message);
      this.emit();
      return;
    }
    // Parakeet stopped working (not a blocked mic, which Chrome's recognizer can't fix): Chrome's takes over.
    if (this.parakeet && this.engine === this.parakeet && !/microphone access is blocked/i.test(message)) {
      // Too slow won't get better by itself: not again until the setting is chosen again.
      const tooSlow = /too slow/i.test(message);
      this.out.log(
        "error",
        `${message}. Chrome's recognizer is listening instead; ${tooSlow ? "choose Parakeet in Settings to try it again" : "Navi tries Parakeet again later"}.`,
      );
      this.parakeet.dispose();
      this.parakeet = null;
      this.parakeetRetryAt = tooSlow ? Infinity : Date.now() + PARAKEET_RETRY_MS;
      void this.start();
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
    this.micError = "";
    this.wantListening = true;
    const generation = ++this.listenGeneration;
    this.engine?.stop();
    this.engine = null;
    const parakeet = this.wantsParakeet() ? this.parakeet : null;
    if (this.settings.recognizer === "parakeet" && !parakeetModelFor(this.settings.lang)) {
      this.callbacks.onInfo?.(`Parakeet doesn't recognize ${this.settings.lang}, so Chrome's recognizer is listening.`);
    }
    // Chosen but not loaded yet: load it while Chrome's recognizer listens.
    if (this.wantsParakeet() && !parakeet) void this.loadParakeet();
    if (!parakeet && !speechSupported()) {
      this.micError = "Speech recognition isn't available in this browser.";
      this.out.log("error", this.micError);
      this.emit();
      return;
    }
    const next = parakeet ?? this.chromeEngine();
    this.engine = next;
    await next.start();
    // A newer start or a stop happened meanwhile: never leave two recognizers running.
    if (generation !== this.listenGeneration) {
      next.stop();
      return;
    }
    // Open mic, and push to talk (the key was just pressed): listening for a command right away.
    if (this.settings.listenMode !== "handsfree") this.session.wake();
    // Load Navi's voice now, so the first reply isn't in the fallback voice while it loads.
    if (naviVoiceOf(this.settings)) void this.speaker.prepareVoice().catch(() => undefined);
    this.emit();
  }

  private stop() {
    this.wantListening = false;
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
