// Speech-to-text behind one interface, so providers can be swapped and compared.
// Chrome's built-in Web Speech API (on-device when supported) here; ElevenLabs Scribe in scribe.ts.

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
 * Opens the mic with noise suppression. With `systemAudio`, asks for echo cancellation "all"
 * (Chrome 141+), which also removes audio the computer itself is playing, such as a podcast.
 */
export async function openCleanMic(systemAudio = false): Promise<MediaStream> {
  const base = { noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  if (!systemAudio) return navigator.mediaDevices.getUserMedia({ audio: { ...base, echoCancellation: true } });
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...base, echoCancellation: "all" as unknown as boolean },
    });
  } catch {
    return navigator.mediaDevices.getUserMedia({ audio: { ...base, echoCancellation: true } });
  }
}

export function speechSupported(): boolean {
  return !!recognitionCtor();
}

export interface WebSpeechOptions {
  lang: string;
  /** Keep audio on this computer when Chrome supports on-device recognition. */
  preferOnDevice: boolean;
  /** If on-device isn't available, may audio go to Google's speech service? */
  allowCloud: boolean;
}

/** How long a partial transcript may sit unchanged before Chrome is told to finish the phrase. */
const STALL_MS = 1400;

export class WebSpeechEngine implements SpeechEngine {
  private recognition: Recognition | null = null;
  private wanted = false;
  private active = false;
  private onDevice = false;
  private restartDelay = 250;
  private lastError = "";
  /** Noise-suppressed mic track handed to the recognizer (Chrome 135+), when supported. */
  private stream: MediaStream | null = null;
  private trackSupported = true;
  private restartTimer: number | undefined;
  /** Fires when the partial transcript stops changing but Chrome hasn't finished the phrase. */
  private stallTimer: number | undefined;

  constructor(
    private readonly options: WebSpeechOptions,
    private readonly callbacks: SpeechCallbacks,
  ) {}

  get label(): string {
    return this.onDevice ? "Chrome speech (on-device)" : "Chrome speech (Google cloud)";
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
    this.onDevice = this.options.preferOnDevice && (await this.prepareOnDevice(Ctor));
    if (!this.onDevice && !this.options.allowCloud) {
      this.wanted = false;
      this.callbacks.onError(
        "On-device speech isn't ready. Download it on Navi's setup page, or allow cloud speech in settings.",
        true,
      );
      return;
    }
    this.callbacks.onInfo?.(`Speech: ${this.label}`);
    await this.openMic();
    if (!this.wanted) return this.closeMic();
    this.launch(Ctor);
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

  /** Uses Chrome's on-device model if present (Chrome 139+), downloading it if needed. */
  private async prepareOnDevice(Ctor: RecognitionCtor): Promise<boolean> {
    if (typeof Ctor.available !== "function") return false;
    const request = { langs: [this.options.lang], processLocally: true };
    try {
      const status = await Ctor.available(request);
      if (status === "available") return true;
      if (status === "downloadable" || status === "downloading") {
        // Downloading needs a click, so it happens on the setup page.
        this.callbacks.onInfo?.("On-device speech can be downloaded on Navi's setup page. Using cloud speech for now.");
      }
    } catch {
      // Fall through to cloud recognition.
    }
    return false;
  }

  private launch(Ctor: RecognitionCtor) {
    if (!this.wanted) return;
    const rec = new Ctor();
    rec.lang = this.options.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    if (this.onDevice && "processLocally" in rec) rec.processLocally = true;

    rec.onstart = () => {
      if (!this.active) {
        this.active = true;
        this.callbacks.onRunningChange(true);
      }
    };
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          // Hearing speech means the mic works: reset the retry delay.
          this.restartDelay = 250;
          this.lastError = "";
          if (transcript.trim()) this.callbacks.onFinal(transcript.trim(), result[0]?.confidence ?? 0);
        } else {
          interim += transcript;
        }
      }
      this.callbacks.onInterim(interim.trim());
      // Background noise can keep Chrome waiting for the end of a phrase that's already over, leaving
      // the words on screen without running them. If they stop changing, make Chrome finish the phrase.
      window.clearTimeout(this.stallTimer);
      if (interim.trim()) this.stallTimer = window.setTimeout(() => rec.stop(), STALL_MS);
    };
    rec.onerror = (event) => {
      // Back off on every real error so a broken mic isn't reopened several times a second.
      if (!["no-speech", "aborted"].includes(event.error)) {
        this.restartDelay = Math.min(this.restartDelay * 2, 30_000);
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
          if (this.onDevice) {
            this.onDevice = false;
            this.callbacks.onInfo?.("On-device speech isn't available for this language; using cloud speech.");
            return;
          }
          this.wanted = false;
          this.callbacks.onError(`Speech recognition doesn't support ${this.options.lang}.`, true);
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
    }
  }
}
