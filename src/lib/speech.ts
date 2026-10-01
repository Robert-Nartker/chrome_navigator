// Speech-to-text behind one interface, so providers can be swapped and compared.
// Chrome's built-in Web Speech API, used in on-device mode only.

export interface SpeechCallbacks {
  onInterim(text: string): void;
  /** confidence is 0-1, or 0 when the engine doesn't report one. */
  onFinal(text: string, confidence: number): void;
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
  0: RecognitionAlternative;
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

/** Opens the mic with noise suppression and echo cancellation. */
function openCleanMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { noiseSuppression: true, autoGainControl: true, channelCount: 1, echoCancellation: true },
  });
}

export function speechSupported(): boolean {
  return !!recognitionCtor();
}

export interface WebSpeechOptions {
  lang: string;
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

/** How long a partial transcript may sit unchanged before Chrome is told to finish the phrase. */
const STALL_MS = 1400;
/** Longest wait between restarts after errors (a broken mic isn't reopened several times a second). */
const MAX_RESTART_MS = 8000;
/** With no sign of life from Chrome's recognizer for this long, it's restarted (it can hang without ending). */
const SILENT_RESTART_MS = 45_000;

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
  private watchdog: number | undefined;
  private hearing = false;
  /** When the current session started, and whether it heard anything: quick empty sessions back off. */
  private launchedAt = 0;
  private heardSinceLaunch = false;

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
    this.watchdog = window.setInterval(() => {
      if (!this.wanted || this.hearing || Date.now() - this.lastSign < SILENT_RESTART_MS) return;
      this.lastSign = Date.now();
      this.recognition?.abort();
    }, 5000);
  }

  /** Opens the mic with noise suppression so keyboard clicks and fans are less likely to become "words". */
  private async openMic() {
    if (!this.trackSupported || this.stream?.getAudioTracks()[0]?.readyState === "live") return;
    try {
      this.stream = await openCleanMic();
    } catch {
      this.stream = null;
    }
  }

  private closeMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  stop() {
    this.wanted = false;
    window.clearInterval(this.watchdog);
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.stallTimer);
    this.recognition?.abort();
    this.recognition = null;
    this.closeMic();
    if (this.active) {
      this.active = false;
      this.callbacks.onRunningChange(false);
    }
  }

  private launch(Ctor: RecognitionCtor) {
    if (!this.wanted) return;
    const rec = new Ctor();
    rec.lang = this.options.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
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
      this.lastSign = Date.now();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          this.heardSinceLaunch = true;
          this.lastError = "";
          if (transcript.trim()) this.callbacks.onFinal(transcript.trim(), result[0]?.confidence ?? 0);
        } else {
          interim += transcript;
        }
      }
      this.hearing = !!interim.trim();
      this.callbacks.onInterim(interim.trim());
      // Background noise can keep Chrome waiting for the end of a phrase that's already over, leaving
      // the words on screen without running them. If they stop changing, make Chrome finish the phrase.
      window.clearTimeout(this.stallTimer);
      if (interim.trim()) this.stallTimer = window.setTimeout(() => rec.stop(), STALL_MS);
    };
    rec.onerror = (event) => {
      // Back off on every real error so a broken mic isn't reopened several times a second.
      if (!["no-speech", "aborted"].includes(event.error)) {
        this.restartDelay = Math.min(this.restartDelay * 2, MAX_RESTART_MS);
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
      window.clearTimeout(this.stallTimer);
      this.hearing = false;
      // A session that heard something, or ran a while, means all is well: restart right away. One that
      // ended at once with nothing heard waits longer each time, so Chrome isn't restarted in a tight loop.
      if (this.heardSinceLaunch || Date.now() - this.launchedAt > 5000) this.restartDelay = 250;
      else this.restartDelay = Math.min(Math.max(this.restartDelay * 2, 500), MAX_RESTART_MS);
      // Anything still shown as "hearing" was never finished; don't leave it on screen.
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
