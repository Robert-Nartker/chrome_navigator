// A stand-in for Chrome's speech recognizer in extension pages: it never errors, and hears what
// `window.__hear(text, isFinal)` says. Navi only uses the recognizer on-device; `status` is what
// `SpeechRecognition.available()` reports ("available" unless a test says otherwise), and `install()`
// makes it "available". The status is kept in localStorage, which all of Navi's pages share, so a
// download from the side panel is seen by the background page that listens.
export function installFakeRecognizer(status = "available") {
  if (location.protocol !== "chrome-extension:") return;
  type Handler = ((event?: unknown) => void) | null;
  const KEY = "__fakeOnDevice";
  const current = () => localStorage.getItem(KEY) ?? status;
  class FakeRecognition {
    onresult: Handler = null;
    onerror: Handler = null;
    onend: Handler = null;
    onstart: Handler = null;
    processLocally = false;
    constructor() {
      (window as unknown as { __recognition: FakeRecognition }).__recognition = this;
    }
    static available() {
      return Promise.resolve(current());
    }
    static install() {
      localStorage.setItem(KEY, "available");
      return Promise.resolve(true);
    }
    start() {
      setTimeout(() => this.onstart?.(), 0);
    }
    stop() {
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
  }
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = w.webkitSpeechRecognition = FakeRecognition;
  w.__hear = (transcript: string, isFinal: boolean) => {
    const result = Object.assign([{ transcript, confidence: 0.95 }], { isFinal });
    (w.__recognition as FakeRecognition | undefined)?.onresult?.({ resultIndex: 0, results: [result] });
  };
}
