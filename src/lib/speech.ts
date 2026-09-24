// Speech-to-text behind one interface, so providers can be swapped and compared.
// Currently: Chrome's built-in Web Speech API, on-device when the browser supports it.

export interface SpeechCallbacks {
  onInterim(text: string): void;
  onFinal(text: string): void;
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
  phrases?: unknown[];
  start(): void;
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

export function speechSupported(): boolean {
  return !!recognitionCtor();
}

export interface WebSpeechOptions {
  lang: string;
  /** Keep audio on this computer when Chrome supports on-device recognition. */
  preferOnDevice: boolean;
  /** If on-device isn't available, may audio go to Google's speech service? */
  allowCloud: boolean;
  /** Words to bias recognition toward (site names, the wake name). */
  phrases: string[];
}

export class WebSpeechEngine implements SpeechEngine {
  private recognition: Recognition | null = null;
  private wanted = false;
  private active = false;
  private onDevice = false;
  private restartDelay = 250;
  private restartTimer: number | undefined;

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
    this.launch(Ctor);
  }

  stop() {
    this.wanted = false;
    window.clearTimeout(this.restartTimer);
    this.recognition?.abort();
    this.recognition = null;
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
    this.applyPhrases(rec);

    rec.onstart = () => {
      this.restartDelay = 250;
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
          if (transcript.trim()) this.callbacks.onFinal(transcript.trim());
        } else {
          interim += transcript;
        }
      }
      this.callbacks.onInterim(interim.trim());
    };
    rec.onerror = (event) => {
      switch (event.error) {
        case "no-speech":
        case "aborted":
          return;
        case "not-allowed":
        case "service-not-allowed":
          this.wanted = false;
          this.callbacks.onError("Microphone access is blocked. Open Navi setup to allow it.", true);
          return;
        case "phrases-not-supported":
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
          this.restartDelay = Math.min(this.restartDelay * 2, 8000);
          this.callbacks.onError("Speech service unreachable, retrying…", false);
          return;
        default:
          this.callbacks.onError(`Speech error: ${event.error}`, false);
      }
    };
    rec.onend = () => {
      // Chrome ends continuous recognition periodically; restart while we still want it.
      if (this.wanted) {
        this.restartTimer = window.setTimeout(() => this.launch(Ctor), this.restartDelay);
      } else if (this.active) {
        this.active = false;
        this.callbacks.onRunningChange(false);
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.callbacks.onError(`Couldn't start speech recognition: ${String(err)}`, false);
    }
  }

  private applyPhrases(rec: Recognition) {
    const Phrase = (window as unknown as { SpeechRecognitionPhrase?: new (phrase: string, boost: number) => unknown })
      .SpeechRecognitionPhrase;
    // Chrome only supports phrase boosting on-device; setting it otherwise is an error.
    if (!this.onDevice || !Phrase || !("phrases" in rec) || this.options.phrases.length === 0) return;
    try {
      rec.phrases = this.options.phrases.map((p) => new Phrase(p, 5));
    } catch {
      // Phrase biasing is optional.
    }
  }
}
