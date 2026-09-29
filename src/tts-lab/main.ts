// Voice lab: listen to free on-device voices side by side, time them, rate them, and pick one.

import { type Settings, loadSettings } from "../lib/settings";
import { listVoices, pickVoice } from "../lib/voice-output";
import { ChunkPlayer, sleep } from "./audio";
import {
  type Download,
  type Engine,
  type EngineId,
  KOKORO_VOICES,
  type LabVoice,
  type LoadStats,
  type RunStats,
  kokoroEngine,
  systemEngine,
  systemVoices,
} from "./engines";
import { type Ratings, blindName, formatBytes, formatMs, realTimeFactor, shuffle, topRated } from "./format";
import type { KokoroDevice } from "./kokoro";

const PARAGRAPH =
  "Here's the article. A new study found that a ten-minute walk after lunch can lower blood sugar for the rest " +
  "of the afternoon. Researchers followed two hundred office workers for six weeks. The walkers felt more alert, " +
  "slept better, and said the habit was easy to keep. The authors suggest starting small, even a few minutes, " +
  "and building from there.";

/** Things Navi actually says, plus a paragraph like "read this page" produces. */
const PHRASES = [
  "Done.",
  "Opening YouTube.",
  "It's 3:40 PM.",
  "I found 3 results for wireless headphones under $50.",
  "Your meeting with Dr. Patel is on Tuesday, October 14th at 10:30.",
  "Sorry, I couldn't find a sign in button on this page.",
  "Opening github.com slash robert-nartker slash chrome_navigator.",
  PARAGRAPH,
];

const RATINGS_KEY = "ttsLabRatings";

const ENGINE_NAMES: Record<EngineId, string> = {
  system: "Chrome",
  kokoro: "Kokoro",
};

const kokoro = kokoroEngine();
const engines: Record<EngineId, Engine> = {
  system: systemEngine,
  kokoro,
};
const voices: Record<EngineId, LabVoice[]> = {
  system: [],
  kokoro: KOKORO_VOICES,
};

let settings: Settings;
let player: ChunkPlayer;
let ratings: Ratings = {};
/** Voices ticked for comparison. */
const selected = new Set<string>();
/** First-load stats, per model (see loadKey). */
const loads = new Map<string, LoadStats>();
/** The latest run of each voice, in the order first played. */
const results = new Map<string, { voice: LabVoice; engine: string; loadKey: string; run: RunStats }>();
let blindOrder: LabVoice[] = [];
let revealed = false;
let current: AbortController | null = null;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const section = (engine: EngineId) => $<HTMLFieldSetElement>(`fieldset.engine[data-engine=${engine}]`);
const customText = $<HTMLTextAreaElement>("#custom-text");
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\.$/, "");

const fullName = (v: LabVoice) => `${v.name} (${ENGINE_NAMES[v.engine]})`;
const isBlind = () => document.body.classList.contains("blind");
const blindIndex = (v: LabVoice) => (isBlind() ? blindOrder.findIndex((b) => b.key === v.key) : -1);

/** The voice's name, or "Voice B" in blind mode. */
function shownName(v: LabVoice): string {
  const i = blindIndex(v);
  if (i < 0) return fullName(v);
  return revealed ? `${blindName(i)}: ${fullName(v)}` : blindName(i);
}

/** Kokoro has one model per device; system voices need no loading. */
function loadKey(v: { engine: EngineId; key?: string }): string {
  if (v.engine === "kokoro") return `kokoro@${kokoro.device}`;
  return v.engine;
}

function setStatus(text: string, error = false) {
  const el = $("#status");
  el.textContent = text;
  el.className = `status${error ? " err" : ""}`;
}

// --- Phrases -------------------------------------------------------------------

function renderPhrases() {
  const box = $("#phrases");
  [...PHRASES, ""].forEach((text, i) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "phrase";
    input.value = String(i);
    input.checked = i === 0;
    const span = document.createElement("span");
    span.textContent =
      text === PARAGRAPH ? `A paragraph, like “read this page”: “${text.slice(0, 70)}…”` : text || "Your text (type it below)";
    label.append(input, span);
    box.append(label);
  });
  customText.addEventListener("input", () => {
    box.querySelector<HTMLInputElement>(`input[value="${PHRASES.length}"]`)!.checked = true;
  });
}

function phrase(): string {
  const i = Number(document.querySelector<HTMLInputElement>("input[name=phrase]:checked")?.value ?? 0);
  return i < PHRASES.length ? PHRASES[i] : customText.value.trim();
}

// --- Voice lists -----------------------------------------------------------------

function ratingSelect(voice: LabVoice, label: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "rating";
  select.dataset.key = voice.key;
  select.setAttribute("aria-label", `Rating for ${label}`);
  select.add(new Option("Rate…", "0"));
  for (let n = 1; n <= 5; n++) select.add(new Option(n === 1 ? "1 (poor)" : n === 5 ? "5 (great)" : String(n), String(n)));
  select.value = String(ratings[voice.key]?.rating ?? 0);
  select.addEventListener("change", () => void rate(voice, Number(select.value)));
  return select;
}

/** One voice: a compare checkbox (or its blind name), Play, and a rating. */
function voiceRow(voice: LabVoice, blind: boolean): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.key = voice.key;
  const label = blind ? shownName(voice) : fullName(voice);
  if (blind) {
    const name = document.createElement("span");
    name.className = "pick";
    name.textContent = label;
    li.append(name);
  } else {
    const pick = document.createElement("label");
    pick.className = "pick";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selected.has(voice.key);
    box.setAttribute("aria-label", `Compare ${label}`);
    box.addEventListener("change", () => (box.checked ? selected.add(voice.key) : selected.delete(voice.key)));
    pick.append(box, voice.name);
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = voice.detail;
    li.append(pick, detail);
  }
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "Play";
  play.setAttribute("aria-label", `Play ${label}`);
  play.addEventListener("click", () => void playOne(voice));
  const note = document.createElement("p");
  note.className = "voice-note";
  note.setAttribute("role", "status");
  li.append(play, ratingSelect(voice, label), note);
  return li;
}

function renderVoices(engine: EngineId) {
  const list = section(engine).querySelector("ul.voices")!;
  let items = voices[engine];
  if (engine === "system" && !$<HTMLInputElement>("#all-languages").checked) {
    items = items.filter((v) => !v.lang || v.lang.toLowerCase().startsWith("en"));
  }
  list.replaceChildren(...items.map((v) => voiceRow(v, false)));
  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Chrome didn't report any voices on this computer.";
    list.append(empty);
  }
}

function setNote(voice: LabVoice, text: string, error = false) {
  for (const li of document.querySelectorAll<HTMLElement>("li[data-key]")) {
    if (li.dataset.key !== voice.key) continue;
    const note = li.querySelector<HTMLElement>(".voice-note")!;
    note.textContent = text;
    note.classList.toggle("err", error);
  }
}

// --- Loading and playing ---------------------------------------------------------

function engineStatus(engine: EngineId, text: string, kind: "" | "ok" | "err" = "") {
  const el = section(engine).querySelector<HTMLElement>(".status");
  if (!el) return;
  el.textContent = text;
  el.className = `status ${kind}`;
}

/** Shows download progress; the bar appears only once something is actually downloading. */
function progressFor(engine: EngineId, label: string) {
  const box = section(engine).querySelector<HTMLElement>(".progress");
  const bar = box?.querySelector("progress");
  const text = box?.querySelector("span");
  return {
    update(d: Download) {
      if (!box || !bar || !text) return;
      box.hidden = false;
      if (d.total) bar.value = d.loaded / d.total;
      else bar.removeAttribute("value");
      text.textContent = `${label}: ${formatBytes(d.loaded)}${d.total ? ` of ${formatBytes(d.total)}` : ""}`;
    },
    done() {
      if (box) box.hidden = true;
    },
  };
}

/** Loads what `voice` (or the whole engine) needs. Returns false and shows why if it fails. */
async function load(engine: EngineId, voice?: LabVoice): Promise<boolean> {
  const what = ENGINE_NAMES[engine];
  const key = loadKey(voice ?? { engine });
  const progress = progressFor(engine, `Downloading ${what}`);
  const downloads = engine === "kokoro";
  if (downloads && !loads.has(key)) engineStatus(engine, `Loading ${what}…`);
  // In blind mode the engine sections are hidden, so report under the voice's letter instead.
  const blind = voice && blindIndex(voice) >= 0 ? shownName(voice) : "";
  const onProgress = (d: Download) => {
    progress.update(d);
    if (blind) setStatus(`${blind}: downloading its voice model, ${formatBytes(d.loaded)}${d.total ? ` of ${formatBytes(d.total)}` : ""}…`);
  };
  try {
    const stats = await engines[engine].prepare(onProgress, voice);
    if (stats) {
      loads.set(key, stats);
      const size = stats.cached ? "already downloaded" : `${formatBytes(stats.bytes)} downloaded and saved for next time`;
      engineStatus(engine, `${what} loaded in ${formatMs(stats.ms)} (${size}).`, "ok");
      renderResults();
      void showStorage();
    }
    return true;
  } catch (err) {
    engineStatus(
      engine,
      `Couldn't load ${what}: ${errorText(err)}. The first load downloads the voice model from Hugging Face ` +
        "(huggingface.co), so check your internet connection and try again.",
      "err",
    );
    if (voice) setNote(voice, `Couldn't load this voice: ${errorText(err)}.`, true);
    if (blind) setStatus(`Couldn't load ${blind}: ${errorText(err)}.`, true);
    return false;
  } finally {
    progress.done();
  }
}

/** Loads and plays one voice, recording its numbers. Returns false if it couldn't. */
async function play(voice: LabVoice, signal: AbortSignal): Promise<boolean> {
  const text = phrase();
  if (!text) {
    setStatus("Type something to say first.", true);
    return false;
  }
  setNote(voice, "");
  if (!(await load(voice.engine, voice))) return false;
  if (signal.aborted) return true;
  try {
    const run = await engines[voice.engine].speak(voice, { text, player, volume: settings.volume, signal });
    if (signal.aborted) return true;
    const engine =
      voice.engine === "kokoro" ? `Kokoro (${kokoro.device === "webgpu" ? "WebGPU" : "WebAssembly"})` : ENGINE_NAMES[voice.engine];
    const key = voice.engine === "kokoro" ? `${voice.key}@${kokoro.device}` : voice.key;
    results.set(key, { voice, engine, loadKey: loadKey(voice), run });
    renderResults();
    return true;
  } catch (err) {
    if (signal.aborted) return true;
    setNote(voice, `Couldn't play: ${errorText(err)}.`, true);
    setStatus(`Couldn't play ${shownName(voice)}: ${errorText(err)}.`, true);
    return false;
  }
}

/** Stops whatever is playing and starts a new run. */
function begin(): AbortSignal {
  stopAll();
  current = new AbortController();
  return current.signal;
}

function stopAll() {
  current?.abort();
  current = null;
  player.stop();
  for (const engine of Object.values(engines)) engine.stop();
}

async function playOne(voice: LabVoice) {
  const signal = begin();
  await player.resume();
  setStatus(`Playing ${shownName(voice)}…`);
  if ((await play(voice, signal)) && !signal.aborted) setStatus("");
}

function selectedVoices(): LabVoice[] {
  return (Object.keys(voices) as EngineId[]).flatMap((e) => voices[e]).filter((v) => selected.has(v.key));
}

async function playAll() {
  const order = isBlind() ? blindOrder : selectedVoices();
  if (!order.length) {
    setStatus("Tick the voices you want to compare first.", true);
    return;
  }
  const signal = begin();
  await player.resume();
  let failed = 0;
  for (const [i, voice] of order.entries()) {
    if (signal.aborted) return;
    setStatus(`Playing ${i + 1} of ${order.length}: ${shownName(voice)}`);
    if (!(await play(voice, signal))) failed++;
    await sleep(600, signal);
  }
  if (signal.aborted) return;
  const played = `Played ${order.length} voice${order.length === 1 ? "" : "s"}`;
  setStatus(failed ? `${played}; ${failed} couldn't play (see the notes next to them).` : `${played}.`, failed > 0);
}

// --- Blind mode, results and ratings ---------------------------------------------

function setBlind(on: boolean) {
  revealed = false;
  document.body.classList.remove("revealed");
  blindOrder = on ? shuffle(selectedVoices()) : [];
  if (on && blindOrder.length < 2) {
    setStatus("Tick at least two voices to compare first.", true);
    $<HTMLInputElement>("#blind").checked = false;
    on = false;
  }
  document.body.classList.toggle("blind", on);
  $("#blind-panel").hidden = !on;
  renderBlind();
  renderResults();
  renderTop();
}

function renderBlind() {
  $("#blind-list").replaceChildren(...blindOrder.map((v) => voiceRow(v, true)));
  $("#reveal").textContent = revealed ? "Hide names" : "Reveal names";
}

function renderResults() {
  const body = $("#results tbody");
  body.replaceChildren(
    ...[...results.values()].map(({ voice, engine, loadKey: key, run }) => {
      const tr = document.createElement("tr");
      const loaded = loads.get(key);
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = shownName(voice);
      tr.append(name);
      const hidden = blindIndex(voice) >= 0 && !revealed;
      const rating = ratings[voice.key]?.rating;
      const cells = hidden
        ? ["hidden until you reveal names", "", "", "", "", "", rating ? `${rating}/5` : "—"]
        : [
            engine,
            loaded ? formatMs(loaded.ms) : "—",
            downloadText(voice, loaded),
            formatMs(run.firstAudioMs),
            formatMs(run.synthMs),
            realTimeFactor(run.synthMs, run.audioSec),
            rating ? `${rating}/5` : "—",
          ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.className = "num";
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  $("#results-empty").hidden = results.size > 0;
}

function downloadText(voice: LabVoice, loaded: LoadStats | undefined): string {
  if (voice.engine === "system") return voice.online ? "none (online voice)" : "none (built in)";
  if (!loaded) return "—";
  if (loaded.cached) return loaded.bytes ? `${formatBytes(loaded.bytes)}, already saved` : "already saved";
  return formatBytes(loaded.bytes);
}

function renderTop() {
  const top = topRated(ratings).map((t) => {
    const voice = blindOrder.find((v) => v.key === t.key);
    const label = voice && blindIndex(voice) >= 0 ? shownName(voice) : t.label;
    const li = document.createElement("li");
    li.textContent = `${label}: ${t.rating}/5`;
    return li;
  });
  $("#top").replaceChildren(...top);
  $("#top-empty").hidden = top.length > 0;
}

async function rate(voice: LabVoice, rating: number) {
  if (rating) ratings[voice.key] = { rating, label: fullName(voice) };
  else delete ratings[voice.key];
  await chrome.storage.local.set({ [RATINGS_KEY]: ratings });
  for (const select of document.querySelectorAll<HTMLSelectElement>("select.rating")) {
    if (select.dataset.key === voice.key) select.value = String(rating);
  }
  renderResults();
  renderTop();
}

// --- Storage -----------------------------------------------------------------------

async function showStorage() {
  const usage = (await navigator.storage?.estimate?.().catch(() => undefined))?.usage ?? 0;
  $("#storage").textContent =
    usage > 100_000
      ? `Downloaded voice models use about ${formatBytes(usage)} on this computer. They stay until you delete them here.`
      : "No voice models downloaded yet.";
}

async function deleteDownloads() {
  if (!confirm("Delete all downloaded voice models? They'll download again the next time you play them.")) return;
  stopAll();
  // Kokoro (transformers.js and kokoro-js) keeps its files in Cache Storage. Voices from older versions of the
  // lab (Pocket TTS, Piper) are cleared too.
  await Promise.all(["transformers-cache", "kokoro-voices", "pocket-tts-js-v1"].map((name) => caches.delete(name)));
  await navigator.storage
    .getDirectory()
    .then((root) => root.removeEntry("piper", { recursive: true }))
    .catch(() => {});
  location.reload();
}

// --- Start -------------------------------------------------------------------------

/** WebGPU when this computer has a usable graphics adapter, otherwise WebAssembly. */
async function setUpKokoroDevice() {
  const select = $<HTMLSelectElement>("#kokoro-device");
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = await Promise.race([gpu?.requestAdapter().catch(() => null), sleep(2000).then(() => null)]);
  if (!adapter) {
    const option = select.querySelector<HTMLOptionElement>("option[value=webgpu]")!;
    option.disabled = true;
    option.textContent += " (not available on this computer)";
  }
  select.value = adapter ? "webgpu" : "wasm";
  kokoro.device = select.value as KokoroDevice;
  select.addEventListener("change", () => {
    kokoro.device = select.value as KokoroDevice;
    engineStatus("kokoro", loads.has(loadKey({ engine: "kokoro" })) ? "" : "The next play downloads and loads the model for this.");
  });
}

async function init() {
  settings = await loadSettings();
  player = new ChunkPlayer(settings.volume);
  ratings = ((await chrome.storage.local.get(RATINGS_KEY))[RATINGS_KEY] as Ratings | undefined) ?? {};
  $("#volume-note").textContent = `Volume: ${Math.round(settings.volume * 100)}%, from Navi's settings. All voices play at normal speed.`;
  renderPhrases();

  const naviVoice = settings.voiceName || (await pickVoice(settings.lang));
  voices.system = systemVoices(await listVoices()).map((v) =>
    v.id === naviVoice ? { ...v, detail: `${v.detail} · Navi's Chrome voice` } : v,
  );
  if (naviVoice) selected.add(`system:${naviVoice}`);
  selected.add(KOKORO_VOICES[0].key);
  for (const engine of Object.keys(voices) as EngineId[]) renderVoices(engine);
  renderResults();
  renderTop();

  $("#all-languages").addEventListener("change", () => renderVoices("system"));
  $("#play-all").addEventListener("click", () => void playAll());
  $("#stop").addEventListener("click", () => {
    stopAll();
    setStatus("Stopped.");
  });
  $<HTMLInputElement>("#blind").addEventListener("change", (e) => setBlind((e.target as HTMLInputElement).checked));
  $("#reveal").addEventListener("click", () => {
    revealed = !revealed;
    document.body.classList.toggle("revealed", revealed);
    renderBlind();
    renderResults();
    renderTop();
  });
  section("kokoro")
    .querySelector(".load")!
    .addEventListener("click", () => void load("kokoro"));
  $("#clear-downloads").addEventListener("click", () => void deleteDownloads());
  void setUpKokoroDevice();
  void showStorage();
}

void init();
