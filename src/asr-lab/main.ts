// Speech recognizer tester: pick a model, talk, and watch it transcribe live; switch models while talking.
// "Compare" runs every loaded model on each finished phrase, so they're judged on the same audio.

import type { AsrEngine, AsrReply, AsrRequest } from "./worker";

interface Model {
  id: string;
  name: string;
  note: string;
  engine: AsrEngine | "chrome";
  repo?: string;
  /** Rough one-time download, for the chip. */
  size: string;
}

const MODELS: Model[] = [
  { id: "chrome", name: "Chrome on-device", note: "What Navi uses today", engine: "chrome", size: "built in" },
  { id: "parakeet-v3", name: "Parakeet v3", note: "NVIDIA · 25 languages", engine: "parakeet", repo: "parakeet-tdt-0.6b-v3", size: "0.7–2.4 GB" },
  { id: "parakeet-v2", name: "Parakeet v2", note: "NVIDIA · English", engine: "parakeet", repo: "parakeet-tdt-0.6b-v2", size: "0.7–2.4 GB" },
  { id: "whisper-small", name: "Whisper small.en", note: "OpenAI · English", engine: "whisper", repo: "Xenova/whisper-small.en", size: "0.3–1 GB" },
  { id: "whisper-turbo", name: "Whisper large-v3 turbo", note: "OpenAI", engine: "whisper", repo: "onnx-community/whisper-large-v3-turbo", size: "1–1.6 GB" },
];

type State = "idle" | "loading" | "ready" | "error";
interface Loaded {
  worker: Worker;
  state: State;
  status: string;
  busy: boolean;
  pending: Map<number, (r: { text: string; ms: number } | null) => void>;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const loaded = new Map<string, Loaded>();
let active = "chrome";
let device: "webgpu" | "wasm" = "wasm";
let nextId = 0;

// ---------- Models ----------

function chip(m: Model): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "model";
  b.dataset.id = m.id;
  b.innerHTML = `<span class="name"></span><span class="note"></span><span class="status"></span>`;
  b.querySelector(".name")!.textContent = m.name;
  b.querySelector(".note")!.textContent = `${m.note} · ${m.size}`;
  b.addEventListener("click", () => void select(m.id));
  return b;
}

function renderChips() {
  for (const b of document.querySelectorAll<HTMLButtonElement>("button.model")) {
    const id = b.dataset.id!;
    const l = loaded.get(id);
    b.setAttribute("aria-pressed", String(id === active));
    b.dataset.state = id === "chrome" ? chromeState : (l?.state ?? "idle");
    b.querySelector(".status")!.textContent = id === "chrome" ? chromeStatus : (l?.status ?? "Click to download and try");
  }
  $("#live-model").textContent = MODELS.find((m) => m.id === active)!.name;
}

function load(m: Model): Loaded {
  const existing = loaded.get(m.id);
  if (existing && existing.state !== "error") return existing;
  existing?.worker.terminate();
  const worker = new Worker(chrome.runtime.getURL("lab/asr-worker.js"), { type: "module" });
  const entry: Loaded = { worker, state: "loading", status: "Starting…", busy: false, pending: new Map() };
  loaded.set(m.id, entry);
  worker.onmessage = ({ data }: MessageEvent<AsrReply>) => {
    if (data.type === "progress") {
      entry.status = data.total ? `Downloading ${mb(data.loaded)} of ${mb(data.total)}` : "Downloading…";
    } else if (data.type === "ready") {
      entry.state = "ready";
      entry.status = `Ready in ${(data.ms / 1000).toFixed(1)} s (${data.detail})`;
    } else if (data.type === "text") {
      entry.pending.get(data.id)?.({ text: data.text, ms: data.ms });
      entry.pending.delete(data.id);
    } else if (data.id !== undefined) {
      entry.pending.get(data.id)?.(null);
      entry.pending.delete(data.id);
      entry.status = `Couldn't transcribe: ${data.message}`;
    } else {
      entry.state = "error";
      entry.status = `Couldn't load: ${data.message}. Click to retry.`;
    }
    renderChips();
  };
  worker.onerror = (e) => {
    e.preventDefault();
    entry.state = "error";
    entry.status = `The model stopped: ${e.message || "out of memory?"}. Click to retry.`;
    renderChips();
  };
  const request: AsrRequest = { type: "load", engine: m.engine as AsrEngine, model: m.repo!, device, vendor: chrome.runtime.getURL("vendor/") };
  worker.postMessage(request);
  renderChips();
  return entry;
}

async function select(id: string) {
  active = id;
  const m = MODELS.find((x) => x.id === id)!;
  if (m.engine !== "chrome") load(m);
  syncChrome();
  $("#live").textContent = "";
  renderChips();
}

/** Transcribes with one loaded model; null if it's not ready or failed. */
function transcribe(id: string, pcm: Float32Array): Promise<{ text: string; ms: number } | null> {
  const l = loaded.get(id);
  if (!l || l.state !== "ready") return Promise.resolve(null);
  const reqId = ++nextId;
  l.busy = true;
  return new Promise((resolve) => {
    l.pending.set(reqId, (r) => {
      l.busy = false;
      resolve(r);
    });
    l.worker.postMessage({ type: "transcribe", id: reqId, pcm } satisfies AsrRequest);
  });
}

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

// ---------- Chrome's on-device recognizer ----------

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type RecCtor = (new () => Rec) & { available?(o: { langs: string[]; processLocally: boolean }): Promise<string> };

let chromeState: State = "ready";
let chromeStatus = "Checking…";
let rec: Rec | null = null;
const Ctor = ((window as unknown as { SpeechRecognition?: RecCtor }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: RecCtor }).webkitSpeechRecognition) as RecCtor | undefined;

async function checkChrome() {
  const status = Ctor?.available ? await Ctor.available({ langs: ["en-US"], processLocally: true }).catch(() => "unavailable") : "unsupported";
  chromeState = status === "available" ? "ready" : "error";
  chromeStatus =
    status === "available"
      ? "Ready (on this computer)"
      : status === "downloadable" || status === "downloading"
        ? "Not downloaded yet: use Navi's setup page"
        : "Not available in this browser";
  renderChips();
}

/** Chrome listens while the mic is on and it's selected, or while comparing. */
function syncChrome() {
  const want = micOn && chromeState === "ready" && (active === "chrome" || compare());
  if (want && !rec && Ctor) {
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) chromeFinal(text.trim());
        else interim += text;
      }
      if (active === "chrome") $("#live").textContent = interim;
    };
    r.onend = () => {
      rec = null;
      syncChrome();
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") chromeStatus = `Error: ${e.error}`;
      renderChips();
    };
    rec = r;
    r.start();
  } else if (!want && rec) {
    const r = rec;
    rec = null;
    r.onend = null;
    r.stop();
  }
}

function chromeFinal(text: string) {
  if (!text) return;
  // Joins the phrase that just ended (or starts its own row when Chrome is the only one listening).
  const row = rows.find((r) => Date.now() - r.endedAt < 2500) ?? (active === "chrome" ? newRow() : null);
  if (!row) return;
  const prev = row.results.get("chrome")?.text;
  setResult(row, "chrome", { text: prev ? `${prev} ${text}` : text, ms: 0 });
  if (active === "chrome") $("#live").textContent = "";
}

// ---------- Microphone and phrases ----------

const RATE = 16000;
let micOn = false;
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let phrase: Float32Array[] = [];
let phraseSamples = 0;
let speaking = false;
let silentMs = 0;
let noise = 0.005;
let lastLiveAt = 0;

async function startMic() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(1024, 1, 1);
  node.onaudioprocess = (e) => onAudio(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);
  micOn = true;
  syncChrome();
}

function stopMic() {
  micOn = false;
  stream?.getTracks().forEach((t) => t.stop());
  void ctx?.close();
  stream = null;
  ctx = null;
  if (speaking) void endPhrase();
  syncChrome();
}

/** A simple level-based phrase detector: speech starts above the noise floor and ends after 0.8 s of quiet. */
function onAudio(chunk: Float32Array) {
  let sum = 0;
  for (const s of chunk) sum += s * s;
  const rms = Math.sqrt(sum / chunk.length);
  const loud = rms > Math.max(0.012, noise * 3);
  if (!loud) noise = noise * 0.95 + rms * 0.05;
  $<HTMLElement>("#level").style.width = `${Math.min(100, rms * 800)}%`;
  const ms = (chunk.length / RATE) * 1000;
  if (loud) {
    if (!speaking) {
      speaking = true;
      phrase = [];
      phraseSamples = 0;
    }
    silentMs = 0;
  } else if (speaking) {
    silentMs += ms;
  }
  if (!speaking) return;
  phrase.push(chunk);
  phraseSamples += chunk.length;
  if (silentMs > 800 || phraseSamples > RATE * 20) void endPhrase();
}

function audio(): Float32Array {
  const out = new Float32Array(phraseSamples);
  let at = 0;
  for (const c of phrase) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** While talking: re-transcribe the phrase so far with the selected model whenever it's free. */
setInterval(async () => {
  if (!speaking || active === "chrome") return;
  const l = loaded.get(active);
  if (!l || l.state !== "ready" || l.busy || phraseSamples < RATE * 0.5 || Date.now() - lastLiveAt < 500) return;
  lastLiveAt = Date.now();
  const id = active;
  const r = await transcribe(id, audio());
  if (r && speaking && id === active) $("#live").textContent = r.text;
}, 150);

// ---------- Results ----------

interface Row {
  el: HTMLLIElement;
  endedAt: number;
  seconds: number;
  results: Map<string, { text: string; ms: number }>;
}
const rows: Row[] = [];
const compare = () => $<HTMLInputElement>("#compare").checked;

function newRow(seconds = 0): Row {
  const el = document.createElement("li");
  el.className = "row";
  const row: Row = { el, endedAt: Date.now(), seconds, results: new Map() };
  rows.unshift(row);
  $("#rows").prepend(el);
  $("#empty").hidden = true;
  return row;
}

function setResult(row: Row, id: string, r: { text: string; ms: number }) {
  row.results.set(id, r);
  row.el.replaceChildren(
    ...[...row.results].map(([mid, res]) => {
      const line = document.createElement("div");
      line.className = "result";
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = MODELS.find((m) => m.id === mid)!.name;
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = res.text || "(nothing)";
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = mid === "chrome" ? "live" : `${(res.ms / 1000).toFixed(2)} s`;
      line.append(who, text, time);
      return line;
    }),
  );
}

async function endPhrase() {
  speaking = false;
  const pcm = audio();
  phrase = [];
  phraseSamples = 0;
  if (pcm.length < RATE * 0.3) return;
  $("#live").textContent = "";
  const row = newRow(pcm.length / RATE);
  const ids = [active, ...(compare() ? [...loaded.keys()].filter((id) => id !== active) : [])].filter((id) => id !== "chrome");
  for (const id of ids) {
    const r = await transcribe(id, pcm);
    if (r) setResult(row, id, r);
  }
}

// ---------- Start ----------

async function init() {
  document.querySelector("#models")!.append(...MODELS.map(chip));
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { description?: string; vendor?: string; architecture?: string } } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  device = adapter ? "webgpu" : "wasm";
  const info = adapter?.info;
  $("#hardware").textContent = adapter
    ? `Models run on your graphics chip (WebGPU${info?.description || info?.vendor ? `: ${info.description || `${info.vendor} ${info.architecture ?? ""}`.trim()}` : ""}).`
    : "No usable graphics chip here, so models run on the processor (slower).";
  $("#mic").addEventListener("click", async () => {
    if (micOn) {
      stopMic();
    } else {
      try {
        await startMic();
      } catch (err) {
        $("#hardware").textContent = `Couldn't open the microphone: ${err instanceof Error ? err.message : String(err)}. Allow it on Navi's setup page.`;
      }
    }
    $("#mic").textContent = micOn ? "Stop listening" : "Start listening";
    $("#mic").setAttribute("aria-pressed", String(micOn));
  });
  $("#compare").addEventListener("change", () => syncChrome());
  renderChips();
  void checkChrome();
}

void init();
