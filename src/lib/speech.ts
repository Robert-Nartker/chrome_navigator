// Speech-to-text behind one interface, so providers can be swapped and compared.
// Chrome's built-in Web Speech API, used in on-device mode only.

export interface SpeechCallbacks {
  onInterim(text: string): void;
  /**
   * confidence is 0-1, or 0 when the engine doesn't report one. `alternatives`: the recognizer's other
   * guesses at the same words, best first (not every engine gives them).
   */
  onFinal(text: string, confidence: number, alternatives?: string[]): void;
  onRunningChange(running: boolean): void;
  onError(message: string, fatal: boolean): void;
  onInfo?(message: string): void;
}

export interface SpeechEngine {
  readonly label: string;
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;
}

// Minimal typings: these APIs are prefixed and newer than TypeScript's DOM lib.
interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent extends Event {
  error: string;
  message: string;
}
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
}
interface RecognitionCtor {
  new (): Recognition;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type OnDeviceStatus = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

/** Whether Chrome can recognize speech on this computer (Chrome 139+). */
export async function onDeviceStatus(lang: string): Promise<OnDeviceStatus> {
  const Ctor = recognitionCtor();
  if (!Ctor || typeof Ctor.available !== "function") return "unsupported";
  try {
    return (await Ctor.available({ langs: [lang], processLocally: true })) as OnDeviceStatus;
  } catch {
    return "unsupported";
  }
}

/** Downloads the on-device model. Must be called from a click. */
export async function installOnDevice(lang: string): Promise<boolean> {
  const Ctor = recognitionCtor();
  if (!Ctor || typeof Ctor.install !== "function") return false;
  return Ctor.install({ langs: [lang], processLocally: true });
}

/**
 * Opens the chosen microphone (`deviceId`, or the default one for ""). If the chosen one is gone
 * (unplugged), the default one is used and `fellBack` is told.
 */
export async function openMicrophone(audio: MediaTrackConstraints, deviceId: string, fellBack?: () => void): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: deviceId } } });
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (!["OverconstrainedError", "NotFoundError", "NotReadableError"].includes(name)) throw err;
      fellBack?.();
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio });
}

/** Opens the mic with noise suppression and echo cancellation. */
function openCleanMic(deviceId: string, fellBack: () => void): Promise<MediaStream> {
  return openMicrophone({ noiseSuppression: true, autoGainControl: true, channelCount: 1, echoCancellation: true }, deviceId, fellBack);
}

export function speechSupported(): boolean {
  return !!recognitionCtor();
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

export interface WebSpeechOptions {
  lang: string;
  /** The microphone to listen with ("" for the default). */
  deviceId?: string;
}

/** Why Chrome's on-device recognizer can't run, for the user. */
export function onDeviceProblem(status: OnDeviceStatus, lang: string): string {
  switch (status) {
    case "downloadable":
    case "downloading":
      return "On-device speech isn't downloaded yet. Download it once and Navi can hear you.";
    case "unavailable":
      return `Chrome can't recognize ${lang} on this computer yet.`;
    default:
      return "This version of Chrome can't recognize speech on-device. Update Chrome (139 or newer).";
  }
}

/**
 * How long a partial transcript may sit unchanged before Navi treats it as finished itself. Chrome can
 * hold a phrase for seconds (or drop it) when it isn't sure the speaker is done.
 */
const STALL_MS = 1100;
/** Pause between Chrome's listening sessions (it ends them every so often; nothing is heard in between). */
const RESTART_MS = 60;
/** Longest wait between restarts after real errors (a broken mic isn't reopened several times a second). */
const MAX_RESTART_MS = 8000;
/** A session that ends sooner than this with nothing heard counts as a failed start. */
const QUICK_FAIL_MS = 1000;
/** With no sign of life from Chrome's recognizer for this long, it's restarted (it can hang without ending). */
const SILENT_RESTART_MS = 45_000;
/** Someone has been talking for a while and Chrome hasn't reacted for this long: it's hung, so restart it. */
const DEAF_MS = 2500;

/**
 * Chrome's recognizer, on-device only: audio never goes to Google's servers. (Chrome's cloud mode is free
 * but has no retention promise, so Navi doesn't use it.)
 */
export class WebSpeechEngine implements SpeechEngine {
  private recognition: Recognition | null = null;
  private wanted = false;
  private active = false;
  private restartDelay = 250;
  private lastError = "";
  /** Noise-suppressed mic track handed to the recognizer (Chrome 135+), when supported. */
  private stream: MediaStream | null = null;
  private trackSupported = true;
  private restartTimer: number | undefined;
  /** Fires when the partial transcript stops changing but Chrome hasn't finished the phrase. */
  private stallTimer: number | undefined;
  /** Last start, audio, or result event from the recognizer. */
  private lastSign = 0;
  /** Last result (partial or final) from the recognizer. */
  private lastResult = 0;
  private watchdog: number | undefined;
  private hearing = false;
  /** When the current session started, and whether it heard anything. */
  private launchedAt = 0;
  private heardSinceLaunch = false;
  /** Sessions in a row that ended at once with nothing heard (Chrome failing to start): those back off. */
  private quickFails = 0;
  /** A real error (mic gone, service down) asks for a longer wait before the next start, longer each time. */
  private errorBackoff = 0;
  private sessionError = false;
  /** A phrase Navi finished itself when Chrome stalled, so Chrome's late copy of it isn't run twice. */
  private forced: { text: string; at: number } | null = null;
  /** Mic loudness, to notice Chrome going deaf while someone talks. */
  private level: { ctx: AudioContext; analyser: AnalyserNode; buffer: Float32Array<ArrayBuffer>; floor: number; loudMs: number } | null = null;
  private lastDeafRestart = 0;
  private lastInterim = "";

  constructor(
    private readonly options: WebSpeechOptions,
    private readonly callbacks: SpeechCallbacks,
  ) {}

  get label(): string {
    return "Chrome speech (on-device)";
  }

  get running(): boolean {
    return this.wanted;
  }

  async start() {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.callbacks.onError("This browser doesn't support speech recognition.", true);
      return;
    }
    this.wanted = true;
    const status = await onDeviceStatus(this.options.lang);
    if (status !== "available") {
      this.wanted = false;
      this.callbacks.onError(onDeviceProblem(status, this.options.lang), true);
      return;
    }
    this.callbacks.onInfo?.(`Speech: ${this.label}`);
    await this.openMic();
    if (!this.wanted) return this.closeMic();
    this.launch(Ctor);
    // Chrome's recognizer can go quiet without ending (no results, no error, no end). If it has shown no
    // sign of life for a while and isn't mid-phrase, restart it: a restart costs a fraction of a second.
    window.clearInterval(this.watchdog);
    this.lastSign = Date.now();
    this.watchdog = window.setInterval(() => this.checkAlive(), 250);
  }

  /**
   * Restarts Chrome's recognizer when it has hung: no sign of life for a long while, or (sooner) the mic
   * has been hearing someone talk for a second or more and Chrome hasn't produced a single word.
   */
  private checkAlive() {
    if (!this.wanted) return;
    const now = Date.now();
    if (!this.hearing && now - this.lastSign > SILENT_RESTART_MS) {
      this.lastSign = now;
      this.recognition?.abort();
      return;
    }
    const loudMs = this.measureLoudness(250);
    const quietSince = Math.max(this.lastResult, this.launchedAt);
    if (loudMs >= 1000 && now - quietSince > DEAF_MS && now - this.lastDeafRestart > 5000) {
      this.lastDeafRestart = now;
      if (this.level) this.level.loudMs = 0;
      this.callbacks.onInfo?.("Chrome's recognizer stopped hearing; restarted it.");
      this.recognition?.abort();
    }
  }

  /** How long the mic has been louder than the room's usual noise, adding `stepMs` if it is now. */
  private measureLoudness(stepMs: number): number {
    const track = this.stream?.getAudioTracks()[0];
    if (!track || track.readyState !== "live") return 0;
    if (!this.level) {
      try {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(this.stream!).connect(analyser);
        this.level = { ctx, analyser, buffer: new Float32Array(analyser.fftSize), floor: 0.01, loudMs: 0 };
      } catch {
        return 0;
      }
    }
    const level = this.level;
    level.analyser.getFloatTimeDomainData(level.buffer);
    let sum = 0;
    for (const v of level.buffer) sum += v * v;
    const rms = Math.sqrt(sum / level.buffer.length);
    // The noise floor follows quiet moments quickly and loud ones slowly, so steady noise isn't "talking".
    level.floor = rms < level.floor ? level.floor * 0.7 + rms * 0.3 : level.floor * 0.995 + rms * 0.005;
    level.loudMs = rms > Math.max(0.015, level.floor * 3) ? level.loudMs + stepMs : 0;
    return level.loudMs;
  }

  /** Opens the mic with noise suppression so keyboard clicks and fans are less likely to become "words". */
  private async openMic() {
    if (!this.trackSupported || this.stream?.getAudioTracks()[0]?.readyState === "live") return;
    try {
      this.stream = await openCleanMic(this.options.deviceId ?? "", () =>
        this.callbacks.onInfo?.("The microphone chosen in settings isn't connected, so Navi is using the default one."),
      );
    } catch {
      this.stream = null;
    }
  }

  private closeMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.level?.ctx.close().catch(() => undefined);
    this.level = null;
  }

  stop() {
    this.wanted = false;
    const rec = this.recognition;
    // Its last events (an end, a late result) are ignored from here on.
    this.recognition = null;
    window.clearInterval(this.watchdog);
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.stallTimer);
    rec?.abort();
    this.closeMic();
    if (this.active) {
      this.active = false;
      this.callbacks.onRunningChange(false);
    }
  }

  /** Chrome's own final copy of a phrase Navi already finished itself. */
  private isForcedCopy(transcript: string): boolean {
    const forced = this.forced;
    if (!forced || Date.now() - forced.at > 4000) return false;
    const t = normalize(transcript);
    return t === forced.text || forced.text.startsWith(t) || t.startsWith(forced.text);
  }

  private launch(Ctor: RecognitionCtor) {
    if (!this.wanted) return;
    const rec = new Ctor();
    rec.lang = this.options.lang;
    rec.continuous = true;
    rec.interimResults = true;
    // Its runner-up guesses: when the best one isn't a command but another is, that's what was meant.
    rec.maxAlternatives = 4;
    rec.processLocally = true;

    rec.onstart = () => {
      this.lastSign = Date.now();
      if (!this.active) {
        this.active = true;
        this.callbacks.onRunningChange(true);
      }
    };
    rec.onaudiostart = () => {
      this.lastSign = Date.now();
    };
    rec.onresult = (event) => {
      if (rec !== this.recognition) return;
      this.lastSign = this.lastResult = Date.now();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          this.heardSinceLaunch = true;
          this.lastError = "";
          const others = Array.from({ length: result.length ?? 1 }, (_, k) => result[k]?.transcript?.trim() ?? "").slice(1).filter(Boolean);
          if (transcript.trim() && !this.isForcedCopy(transcript)) this.callbacks.onFinal(transcript.trim(), result[0]?.confidence ?? 0, others);
        } else {
          interim += transcript;
        }
      }
      const words = interim.trim();
      this.hearing = !!words;
      this.lastInterim = words;
      this.callbacks.onInterim(words);
      // Chrome can sit on a phrase that's already over (unsure the speaker is done, or hearing noise),
      // leaving the words on screen without running them, and sometimes drops them. If they stop changing,
      // Navi finishes the phrase itself and starts a fresh session, so the next thing said is heard.
      window.clearTimeout(this.stallTimer);
      if (words) {
        this.stallTimer = window.setTimeout(() => {
          if (rec !== this.recognition) return;
          this.forced = { text: normalize(words), at: Date.now() };
          this.heardSinceLaunch = true;
          this.hearing = false;
          this.callbacks.onInterim("");
          this.callbacks.onFinal(words, 0);
          rec.abort();
        }, STALL_MS);
      }
    };
    rec.onerror = (event) => {
      // Back off on every real error so a broken mic isn't reopened several times a second.
      if (!["no-speech", "aborted"].includes(event.error)) {
        this.sessionError = true;
        this.errorBackoff = Math.min(Math.max(this.errorBackoff * 2, 500), MAX_RESTART_MS);
      }
      const report = (message: string) => {
        if (message !== this.lastError) this.callbacks.onError(message, false);
        this.lastError = message;
      };
      switch (event.error) {
        case "no-speech":
        case "aborted":
          return;
        case "not-allowed":
        case "service-not-allowed":
          this.wanted = false;
          this.callbacks.onError("Microphone access is blocked. Open Navi setup to allow it.", true);
          return;
        case "language-not-supported":
          this.wanted = false;
          this.callbacks.onError(onDeviceProblem("unavailable", this.options.lang), true);
          return;
        case "network":
          report("Speech service unreachable. Retrying…");
          return;
        case "audio-capture":
          // The mic disappeared (unplugged, in use, or the audio system hiccuped): reopen it later.
          this.closeMic();
          report("Can't hear the microphone. Check it's connected; retrying…");
          return;
        default:
          report(`Speech error: ${event.error}`);
      }
    };
    rec.onend = () => {
      if (rec !== this.recognition) return;
      window.clearTimeout(this.stallTimer);
      // A phrase still on screen when Chrome ends the session is finished, not thrown away.
      if (this.hearing && this.lastInterim) {
        this.forced = { text: normalize(this.lastInterim), at: Date.now() };
        this.callbacks.onFinal(this.lastInterim, 0);
      }
      this.hearing = false;
      // Chrome ends sessions every so often, and after silence: restart at once, so nothing said is missed.
      // Only a session that failed straight away (nothing heard, under a second) or a real error waits,
      // longer each time, so a broken recognizer isn't restarted in a tight loop.
      const quickFail = !this.heardSinceLaunch && Date.now() - this.launchedAt < QUICK_FAIL_MS;
      this.quickFails = quickFail ? this.quickFails + 1 : 0;
      this.restartDelay = Math.max(
        RESTART_MS,
        this.sessionError ? this.errorBackoff : 0,
        this.quickFails ? Math.min(250 * 2 ** this.quickFails, MAX_RESTART_MS) : 0,
      );
      // A session without errors: the next error starts the wait over.
      if (!this.sessionError) this.errorBackoff = 0;
      this.sessionError = false;
      this.callbacks.onInterim("");
      // Chrome ends continuous recognition periodically; restart while we still want it.
      if (this.wanted) {
        this.restartTimer = window.setTimeout(async () => {
          await this.openMic();
          this.launch(Ctor);
        }, this.restartDelay);
      } else if (this.active) {
        this.active = false;
        this.callbacks.onRunningChange(false);
      }
    };

    this.recognition = rec;
    this.launchedAt = Date.now();
    this.heardSinceLaunch = false;
    this.lastInterim = "";
    const track = this.stream?.getAudioTracks()[0];
    try {
      if (track?.readyState === "live") rec.start(track);
      else rec.start();
    } catch (err) {
      if (track) {
        // Older Chrome: no start(track). Use Chrome's own mic capture instead.
        this.trackSupported = false;
        this.closeMic();
        try {
          rec.start();
          return;
        } catch (inner) {
          err = inner;
        }
      }
      this.callbacks.onError(`Couldn't start speech recognition: ${String(err)}`, false);
      // No end event follows a failed start, so try again (backing off) rather than go deaf.
      this.restartDelay = Math.min(this.restartDelay * 2, MAX_RESTART_MS);
      window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(async () => {
        await this.openMic();
        this.launch(Ctor);
      }, this.restartDelay);
    }
  }
}
