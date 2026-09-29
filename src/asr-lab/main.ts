// Speech recognizer tester: pick a model, talk, and watch it transcribe live; switch models while talking.
// "Compare" runs every loaded model on each finished phrase, so they're judged on the same audio.

import type { QwenFilesRequest } from "./qwen-files";
import { startDevReload } from "../lib/dev-reload";
import { VAD_FRAME, type Vad, loadVad } from "./vad";
import type { AsrEngine, AsrReply, AsrRequest } from "./worker";

interface Model {
  id: string;
  name: string;
  note: string;
  engine: AsrEngine | "chrome" | "qwen";
  repo?: string;
  qwen?: QwenFilesRequest;
  /** Rough one-time download, for the chip. */
  size: string;
}

const HF = "https://huggingface.co";
const MODELS: Model[] = [
  { id: "chrome", name: "Chrome on-device", note: "What Navi uses today", engine: "chrome", size: "built in" },
  {
    id: "qwen-1.7b",
    name: "Qwen3-ASR 1.7B",
    note: "Alibaba · graphics chip only",
    engine: "qwen",
    qwen: { dir: "1.7b", base: `${HF}/ainoya/qwen3-asr-1.7b-q8-packed/resolve/main`, packed: "qwen-asr-q8.bin" },
    size: "2.2 GB",
  },
  {
    id: "qwen-0.6b",
    name: "Qwen3-ASR 0.6B",
    note: "Alibaba · graphics chip only",
    engine: "qwen",
    // Only published at full precision, so it's packed to 8 bits on the way in.
    qwen: { dir: "0.6b", base: `${HF}/Qwen/Qwen3-ASR-0.6B/resolve/main` },
    size: "~1.9 GB download, 0.9 GB kept",
  },
  { id: "parakeet-v3", name: "Parakeet v3", note: "NVIDIA · 25 languages", engine: "parakeet", repo: "parakeet-tdt-0.6b-v3", size: "0.7–2.4 GB" },
  { id: "parakeet-v2", name: "Parakeet v2", note: "NVIDIA · English", engine: "parakeet", repo: "parakeet-tdt-0.6b-v2", size: "0.7–2.4 GB" },
  { id: "whisper-turbo", name: "Whisper large-v3 turbo", note: "OpenAI", engine: "whisper", repo: "onnx-community/whisper-large-v3-turbo", size: "1–1.6 GB" },
];

type State = "idle" | "loading" | "ready" | "error";
type Heard = { text: string; ms: number } | null;
interface Loaded {
  state: State;
  status: string;
  busy: boolean;
  run: (pcm: Float32Array) => Promise<Heard>;
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
  const entry = m.engine === "qwen" ? loadQwenModel(m) : loadInWorker(m);
  loaded.set(m.id, entry);
  renderChips();
  return entry;
}

/** Whisper and Parakeet each run in their own worker. */
function loadInWorker(m: Model): Loaded {
  const worker = new Worker(chrome.runtime.getURL("lab/asr-worker.js"), { type: "module" });
  const pending = new Map<number, (r: Heard) => void>();
  const entry: Loaded = {
    state: "loading",
    status: "Starting…",
    busy: false,
    run: (pcm) =>
      new Promise((resolve) => {
        const id = ++nextId;
        pending.set(id, resolve);
        worker.postMessage({ type: "transcribe", id, pcm } satisfies AsrRequest);
      }),
  };
  const stop = (status: string) => {
    entry.state = "error";
    entry.status = status;
    worker.terminate();
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
  };
  worker.onmessage = ({ data }: MessageEvent<AsrReply>) => {
    if (data.type === "progress") {
      entry.status = data.total ? `Downloading ${mb(data.loaded)} of ${mb(data.total)}` : "Downloading…";
    } else if (data.type === "ready") {
      entry.state = "ready";
      entry.status = `Ready in ${(data.ms / 1000).toFixed(1)} s (${data.detail})`;
    } else if (data.type === "text") {
      pending.get(data.id)?.({ text: data.text, ms: data.ms });
      pending.delete(data.id);
    } else if (data.id !== undefined) {
      pending.get(data.id)?.(null);
      pending.delete(data.id);
      entry.status = `Couldn't transcribe: ${data.message}`;
    } else {
      stop(`Couldn't load: ${data.message}. Click to retry.`);
    }
    renderChips();
  };
  worker.onerror = (e) => {
    e.preventDefault();
    stop(`The model stopped: ${e.message || "out of memory?"}. Click to retry.`);
    renderChips();
  };
  const request: AsrRequest = { type: "load", engine: m.engine as AsrEngine, model: m.repo!, device, vendor: chrome.runtime.getURL("vendor/") };
  worker.postMessage(request);
  return entry;
}

/** Qwen3-ASR runs on this page (its engine needs the page's thread for the graphics chip). */
function loadQwenModel(m: Model): Loaded {
  const entry: Loaded = { state: "loading", status: "Starting…", busy: false, run: async () => null };
  const start = performance.now();
  const onStatus = (s: string) => {
    entry.status = s;
    renderChips();
  };
  void import("./qwen")
    .then(({ loadQwen }) => loadQwen(m.qwen!, onStatus))
    .then((model) => {
      entry.run = async (pcm) => {
        const t0 = performance.now();
        try {
          return { text: (await model.transcribe(pcm)).trim(), ms: performance.now() - t0 };
        } catch (err) {
          onStatus(`Couldn't transcribe: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      };
      entry.state = "ready";
      onStatus(`Ready in ${((performance.now() - start) / 1000).toFixed(1)} s (${model.detail})`);
    })
    .catch((err) => {
      entry.state = "error";
      onStatus(`Couldn't load: ${err instanceof Error ? err.message : String(err)}. Click to retry.`);
    });
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
async function transcribe(id: string, pcm: Float32Array): Promise<Heard> {
  const l = loaded.get(id);
  if (!l || l.state !== "ready") return null;
  l.busy = true;
  try {
    return await l.run(pcm);
  } finally {
    l.busy = false;
  }
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

/** Chrome's text that came in before the phrase it belongs to ended. */
let earlyChrome: { text: string; at: number } | null = null;

function chromeFinal(text: string) {
  if (!text) return;
  if (active === "chrome") $("#live").textContent = "";
  // Joins the phrase that just ended, or waits for it to end (Chrome often finishes first); starts its
  // own row when Chrome is the only one listening.
  const row = rows.find((r) => Date.now() - r.endedAt < 2500) ?? (active === "chrome" && !speaking ? newRow() : null);
  if (!row) {
    earlyChrome = { text: earlyChrome ? `${earlyChrome.text} ${text}` : text, at: Date.now() };
    return;
  }
  addChrome(row, text);
}

function addChrome(row: Row, text: string) {
  const prev = row.results.get("chrome")?.text;
  setResult(row, "chrome", { text: prev ? `${prev} ${text}` : text, ms: 0 });
}

// ---------- Microphone and phrases ----------

const RATE = 16000;
let micOn = false;
let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let phrase: Float32Array[] = [];
let phraseSamples = 0;
let speaking = false;
let lastLiveAt = 0;

// A phrase starts when Silero VAD is fairly sure it hears speech, and ends once it has heard none for
// HANG_MS. Unlike a loudness check, it isn't fooled by a fan or air conditioner.
const START = 0.5;
const STILL = 0.35;
const HANG_MS = 350;
/** Kept from before speech is detected, so a phrase keeps its first sound. */
const PREROLL_MS = 300;
/** Shorter blips (a cough, a click) aren't phrases. */
const MIN_VOICED_MS = 150;
const FRAME_MS = (VAD_FRAME / RATE) * 1000;

let vad: Vad | null = null;
let frames = Promise.resolve();
let pendingSamples = new Float32Array(0);
let preroll: Float32Array[] = [];
let quietMs = 0;
let voicedMs = 0;
// Loudness fallback, used only if the speech detector can't load.
let noise = 0.005;

async function startMic() {
  // Chrome's noise suppression smears quiet speech, and these models are trained on raw audio; gain
  // control stays on so a quiet mic still reaches them at a normal level.
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
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
  frames = frames.then(() => {
    if (speaking) void endPhrase();
    vad?.reset();
    pendingSamples = new Float32Array(0);
    preroll = [];
  });
  syncChrome();
}

function onAudio(chunk: Float32Array) {
  let sum = 0;
  for (const s of chunk) sum += s * s;
  $<HTMLElement>("#level").style.width = `${Math.min(100, Math.sqrt(sum / chunk.length) * 800)}%`;
  const all = new Float32Array(pendingSamples.length + chunk.length);
  all.set(pendingSamples);
  all.set(chunk, pendingSamples.length);
  let at = 0;
  for (; at + VAD_FRAME <= all.length; at += VAD_FRAME) {
    const frame = all.slice(at, at + VAD_FRAME);
    frames = frames.then(() => onFrame(frame)).catch(() => undefined);
  }
  pendingSamples = all.slice(at);
}

async function speechProbability(frame: Float32Array): Promise<number> {
  if (vad) return vad.run(frame);
  let sum = 0;
  for (const s of frame) sum += s * s;
  const rms = Math.sqrt(sum / frame.length);
  const loud = rms > Math.max(0.006, noise * 3);
  if (!loud) noise = noise * 0.95 + rms * 0.05;
  return loud ? 1 : 0;
}

async function onFrame(frame: Float32Array) {
  const p = await speechProbability(frame);
  if (!speaking) {
    preroll.push(frame);
    if (preroll.length * FRAME_MS > PREROLL_MS) preroll.shift();
    if (p < START) return;
    speaking = true;
    phrase = preroll;
    phraseSamples = preroll.length * VAD_FRAME;
    preroll = [];
    quietMs = 0;
    voicedMs = FRAME_MS;
    return;
  }
  phrase.push(frame);
  phraseSamples += frame.length;
  if (p >= STILL) {
    voicedMs += FRAME_MS;
    quietMs = 0;
  } else {
    quietMs += FRAME_MS;
  }
  if (quietMs >= HANG_MS || phraseSamples > RATE * 20) {
    if (voicedMs >= MIN_VOICED_MS) void endPhrase();
    else {
      speaking = false;
      phrase = [];
      phraseSamples = 0;
    }
  }
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
  if (earlyChrome) {
    if (Date.now() - earlyChrome.at < 20_000) addChrome(row, earlyChrome.text);
    earlyChrome = null;
  }
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
  loadVad(chrome.runtime.getURL("vendor/"))
    .then((v) => {
      vad = v;
      $("#detector").textContent = "Speech detector: Silero VAD (on this computer). A phrase ends about 0.35 s after you stop talking.";
    })
    .catch((err) => {
      $("#detector").textContent = `The speech detector didn't load (${err instanceof Error ? err.message : String(err)}), so phrases are split by loudness.`;
    });
  if (__DEV__) void startDevReload(() => undefined, { background: true, reopen: true });
}

void init();
