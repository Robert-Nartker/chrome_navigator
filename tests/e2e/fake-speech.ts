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
    /** Started and not yet stopped. */
    live = false;
    /** The microphone it was given (Navi passes its own mic track). */
    trackLabel = "";
    /** This session's results, as Chrome keeps them: pieces of speech, only the last one still changing. */
    pieces: { transcript: string; isFinal: boolean; others: string[] }[] = [];
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
    start(track?: MediaStreamTrack) {
      this.live = true;
      this.trackLabel = track?.label ?? "";
      setTimeout(() => this.onstart?.(), 0);
    }
    stop() {
      this.live = false;
      setTimeout(() => this.onend?.(), 0);
    }
    abort() {
      this.stop();
    }
  }
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = w.webkitSpeechRecognition = FakeRecognition;
  w.__hear = (transcript: string, isFinal: boolean, others: string[] = []) => {
    const rec = w.__recognition as FakeRecognition | undefined;
    if (!rec) return;
    const last = rec.pieces.at(-1);
    if (last && !last.isFinal) Object.assign(last, { transcript, isFinal, others });
    else rec.pieces.push({ transcript, isFinal, others });
    const results = rec.pieces.map((p) =>
      Object.assign([{ transcript: p.transcript, confidence: 0.95 }, ...p.others.map((t) => ({ transcript: t, confidence: 0.5 }))], { isFinal: p.isFinal }),
    );
    rec.onresult?.({ resultIndex: rec.pieces.length - 1, results });
  };
}
