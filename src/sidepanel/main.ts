// Side panel: a view of Navi, which runs in the background (worker + offscreen ears) whether or not
// this panel is open. It shows the live caption, status and activity feed, and passes on the mic
// button, typed commands and toolbar buttons.

import { startDevReload } from "../lib/dev-reload";
import {
  EARS_OFF,
  type EarsEvent,
  type EarsRequest,
  type EarsState,
  type LogEntry,
  type ViewEvent,
  type WorkerHello,
  type WorkerRequest,
  type WorkerState,
} from "../lib/messages";
import { type CommandMetric, loadMetrics } from "../lib/metrics";
import { MODEL_CATALOG, formatCost, modelInfo } from "../lib/models";
import { parseCommand } from "../lib/parser";
import {
  DEFAULT_SETTINGS,
  type Settings,
  activeSettings,
  aiModeOf,
  loadSettings,
  onSettingsChanged,
  providersWithKeys,
  saveSettings,
} from "../lib/settings";
import { installOnDevice, onDeviceStatus } from "../lib/speech";
import { Feed } from "./feed";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  status: $("status"),
  statusText: $("status-text"),
  mic: $<HTMLButtonElement>("mic"),
  interim: $("interim"),
  log: $<HTMLOListElement>("log"),
  form: $<HTMLFormElement>("command-form"),
  input: $<HTMLInputElement>("command-input"),
  micBanner: $("mic-banner"),
  speechBanner: $("speech-banner"),
  speechBannerText: $("speech-banner-text"),
  downloadSpeech: $<HTMLButtonElement>("download-speech"),
  keyBanner: $("key-banner"),
  sessionBar: $("session-bar"),
  numbersButton: $<HTMLButtonElement>("toggle-numbers"),
  gridButton: $<HTMLButtonElement>("toggle-grid"),
  engine: $("engine"),
  dictate: $<HTMLButtonElement>("dictate"),
  engineLabel: $("engine-label"),
};

let settings: Settings = DEFAULT_SETTINGS;
let ears: EarsState = EARS_OFF;
let worker: WorkerState = { working: false, numbers: false, grid: false, listening: false };
/** Mirror of the worker's metrics (for tests and the benchmark). */
const metrics: CommandMetric[] = [];
const feed = new Feed(ui.log, $("announcer"));

const toWorker = <T = unknown>(request: WorkerRequest) => chrome.runtime.sendMessage(request) as Promise<T>;

function renderStatus() {
  let state = "off";
  let text = "Mic off";
  const problem = ears.micError || worker.problem;
  if (problem) {
    state = "error";
    text = "Mic unavailable";
  } else if (ears.dictating) {
    state = "awake";
    text = "Dictating into the chat box…";
  } else if (worker.working) {
    state = "working";
    text = worker.detail ?? "Working…";
  } else if (ears.listening) {
    if (settings.listenMode === "open") {
      state = "awake";
      text = "Open mic: just say a command";
    } else if (ears.awake) {
      state = "awake";
      text = "Awake: just say a command";
    } else {
      state = "sleeping";
      text = `Say “Hey ${settings.wakeName}”`;
    }
  } else if (worker.listening) {
    // Asked to listen; the mic is still opening.
    state = "starting";
    text = "Starting the mic…";
  }
  showStatus(state, text, worker.detail);
  const listening = worker.listening;
  ui.dictate.setAttribute("aria-pressed", String(ears.dictating));
  ui.dictate.setAttribute("aria-label", ears.dictating ? "Stop dictating" : "Dictate a message");
  ui.mic.setAttribute("aria-pressed", String(listening));
  ui.mic.setAttribute("aria-label", listening ? "Stop listening" : "Start listening");
  ui.mic.dataset.awake = String(ears.awake && settings.listenMode === "handsfree");
  // What's hearing and speaking right now, so it's always clear what runs locally and what's paid.
  const engines = [ears.engineLabel && `Hears: ${ears.engineLabel}`, ears.voiceLabel && `Speaks: ${ears.voiceLabel}`];
  const engineText = engines.filter(Boolean).join(" · ");
  ui.engine.hidden = !ears.engineLabel;
  setText(ui.engineLabel, engineText);
  ui.engine.title = engineText;
  renderSessionBar();
  setToggle(ui.numbersButton, worker.numbers, worker.numbers ? "Hide flags" : "Flags");
  setToggle(ui.gridButton, worker.grid, worker.grid ? "Hide grid" : "Grid");
}

const STATUS_LABELS: Record<string, string> = {
  off: "Mic off",
  error: "Mic unavailable",
  working: "Working",
  awake: "Listening",
  sleeping: "Asleep",
  starting: "Starting",
};
const voiceCard = $("voice");
const captionHint = $("caption-hint");

/** Header pill (short, announced), the voice card's look, and the hint shown while nothing is being heard. */
function showStatus(state: string, text: string, detail?: string) {
  feed.setWorking(worker.working, detail);
  ui.status.dataset.state = state;
  voiceCard.dataset.state = state;
  setText(ui.statusText, STATUS_LABELS[state] ?? text);
  const hint =
    state === "off"
      ? "Click the mic to talk, or type below."
      : state === "error"
        ? ears.micError || worker.problem || text
        : state === "working"
          ? feed.activity || text
          : text;
  setText(captionHint, hint);
}

/** Only touches the DOM on a change, so live regions don't repeat themselves. */
function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

function setToggle(button: HTMLButtonElement, on: boolean, label: string) {
  button.dataset.on = String(on);
  setText(button.querySelector<HTMLElement>(".label") ?? button, label);
}

function renderSessionBar() {
  const show = ears.listening && settings.listenMode === "handsfree" && ears.remainingMs > 0;
  ui.sessionBar.hidden = !show;
  if (show) {
    const pct = (ears.remainingMs / (settings.sessionTimeoutSec * 1000)) * 100;
    (ui.sessionBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
  }
}

function showInterim(text: string) {
  // Keep a runaway transcript (e.g. noise heard as words) to a few readable lines, newest words in view.
  ui.interim.textContent = text.length > 120 ? `…${text.slice(-120)}` : text;
  ui.interim.scrollTop = ui.interim.scrollHeight;
}

function addMetric(metric: CommandMetric) {
  const last = metrics[metrics.length - 1];
  if (last && last.t === metric.t && last.command === metric.command) return;
  metrics.push(metric);
  if (metric.costUsd) spentToday += metric.costUsd;
  renderPlan();
}

/** AI cost since midnight (from the usage log, which outlives the worker). */
let spentToday = 0;
async function loadSpentToday() {
  const today = new Date().toDateString();
  spentToday = (await loadMetrics().catch(() => []))
    .filter((m) => new Date(m.t).toDateString() === today)
    .reduce((sum, m) => sum + (Number.isFinite(m.costUsd) ? (m.costUsd ?? 0) : 0), 0);
  renderPlan();
}

/** The Free / Pro chip: what's running, and whether it costs anything. */
function renderPlan() {
  const button = $<HTMLButtonElement>("plan");
  const mode = aiModeOf(settings);
  const active = activeSettings(settings);
  button.dataset.plan = mode;
  setText($("plan-label"), mode === "free" ? "Free" : `Pro · ${formatCost(spentToday)} today`);
  const router = active.routerModel === "off" ? "none" : modelInfo(active.routerModel).label;
  button.title =
    mode === "free"
      ? "Navi Free: built-in commands, plus chat and voice commands on this computer (Gemini Nano). No cost. It can't click or type on pages. Click for Pro."
      : `Navi Pro, billed to your API key: ${modelInfo(active.model).label} for tasks and chat, ${router} for quick checks. Click for Free (no cost).`;
  button.setAttribute("aria-label", `${mode === "free" ? "Navi Free, no cost" : `Navi Pro, ${formatCost(spentToday)} spent today`}. Switch to ${mode === "free" ? "Pro" : "Free"}.`);
}

$("plan").addEventListener("click", () => {
  if (aiModeOf(settings) === "pro") void saveSettings({ aiMode: "free" });
  // Pro needs a key: without one, go and connect it.
  else if (providersWithKeys(settings).length) void saveSettings({ aiMode: "pro" });
  else void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html#ai") });
});

async function checkMicPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    ui.micBanner.hidden = status.state === "granted";
    status.onchange = () => {
      ui.micBanner.hidden = status.state === "granted";
      renderStatus();
    };
    return status.state === "granted";
  } catch {
    return true;
  }
}

function applySettings(next: Settings) {
  settings = next;
  document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) => (r.checked = r.value === next.listenMode));
  document.querySelectorAll(".wake-name").forEach((el) => (el.textContent = next.wakeName));
  const handsFree = document.querySelector<HTMLElement>("label:has(input[value=handsfree])");
  if (handsFree) handsFree.title = `Say “Hey ${next.wakeName}”, then talk.`;
  // Until the user picks Free or connects a key, say which one is running.
  ui.keyBanner.hidden = providersWithKeys(next).length > 0 || next.aiMode === "free";
  renderPlan();
  renderStatus();
}

function openSettings(e?: Event) {
  e?.preventDefault();
  void chrome.runtime.openOptionsPage();
}

ui.mic.addEventListener("click", () => {
  void toWorker({ type: "navi:listen", on: !(worker.listening || ears.listening) });
});

document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((radio) =>
  radio.addEventListener("change", () => void saveSettings({ listenMode: radio.value as Settings["listenMode"] })),
);

/** What was in the chat box when dictation started; dictated words go after it. */
let dictationBase: string | null = null;

function showDictation(text: string, final: boolean) {
  dictationBase ??= ui.input.value;
  const base = dictationBase.trimEnd();
  ui.input.value = base && text ? `${base} ${text}` : base || text;
  if (final) {
    dictationBase = null;
    ui.input.focus();
    ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
  }
}

ui.dictate.addEventListener("click", () => {
  const on = !ears.dictating;
  dictationBase = on ? ui.input.value : null;
  void toWorker({ type: "navi:dictate", on });
});

ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (ears.dictating) void toWorker({ type: "navi:dictate", on: false });
  dictationBase = null;
  const text = ui.input.value;
  ui.input.value = "";
  // Typed commands skip the wake word.
  void navi.run(text);
});

$("open-setup").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") }));

/** Navi only uses Chrome's on-device recognizer; offer its one-time download here (it needs a click). */
async function checkOnDeviceSpeech() {
  const status = await onDeviceStatus(settings.lang);
  ui.speechBanner.hidden = status !== "downloadable" && status !== "downloading";
  ui.downloadSpeech.disabled = status === "downloading";
  if (status === "downloading") window.setTimeout(() => void checkOnDeviceSpeech(), 3000);
  return status;
}

ui.downloadSpeech.addEventListener("click", async () => {
  ui.downloadSpeech.disabled = true;
  ui.speechBannerText.textContent = "Downloading on-device speech…";
  try {
    await installOnDevice(settings.lang);
  } catch (err) {
    ui.speechBannerText.textContent = `Download failed: ${String(err)}`;
    ui.downloadSpeech.disabled = false;
    return;
  }
  if ((await checkOnDeviceSpeech()) !== "available") return;
  // Listening stopped because the recognizer was missing: start again now that it's here.
  if (worker.listening || settings.listenMode === "handsfree") {
    await toWorker({ type: "navi:listen", on: false });
    void toWorker({ type: "navi:listen", on: true });
  }
});
$("open-settings").addEventListener("click", openSettings);
$("open-settings-inline").addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html#ai") });
});
$("help").addEventListener("click", () => void toWorker({ type: "navi:help" }));
ui.gridButton.addEventListener("click", () => void toWorker({ type: "navi:toggle", what: "grid" }));
ui.numbersButton.addEventListener("click", () => void toWorker({ type: "navi:toggle", what: "numbers" }));

// Live updates from the worker and the ears.
chrome.runtime.onMessage.addListener((message: unknown) => {
  const msg = message as
    | ViewEvent
    | Extract<EarsEvent, { type: "ears:state" | "ears:interim" | "ears:dictation" }>
    | { type: "navi:mic-granted" };
  switch (msg.type) {
    case "view:log":
      feed.push(msg.entry);
      break;
    case "view:worker":
      worker = msg.state;
      renderStatus();
      break;
    case "view:metric":
      addMetric(msg.metric);
      break;
    case "ears:state":
      ears = msg.state;
      renderStatus();
      break;
    case "ears:interim":
      showInterim(msg.text);
      break;
    case "ears:dictation":
      showDictation(msg.text, msg.final);
      break;
    case "navi:mic-granted":
      ui.micBanner.hidden = true;
      renderStatus();
      break;
  }
  // Never answers: requests are for the worker and the ears.
  return false;
});

const earsTest = <T = unknown>(ears: Extract<EarsRequest, { type: "ears:test" }>) =>
  toWorker<T>({ type: "navi:test", action: "ears", ears });

// Exposed for automated tests, the benchmark, and debugging from DevTools.
const navi = {
  /** Runs a typed message, or with source "voice" a command as if spoken (tests, benchmark). */
  async run(text: string, source: "typed" | "voice" = "typed") {
    const result = await toWorker<{ metrics: CommandMetric[]; worker?: WorkerState } | undefined>({ type: "navi:run", text, source });
    if (result?.metrics) metrics.splice(0, metrics.length, ...result.metrics);
  },
  handleFinal: (text: string, confidence = 0) => earsTest({ type: "ears:test", action: "final", text, confidence }),
  // For the router benchmark: one routing call with the current settings, timed.
  route: (text: string, recent?: { said: string; outcome: string }[]) => toWorker({ type: "navi:test", action: "route", text, recent }),
  parse: (text: string) => parseCommand(text),
  models: MODEL_CATALOG,
  startListening: () => toWorker({ type: "navi:listen", on: true }),
  stopListening: () => toWorker({ type: "navi:listen", on: false }),
  get lastSaid() {
    return earsTest<string>({ type: "ears:test", action: "lastSaid" });
  },
  session: {
    get current() {
      return earsTest<string>({ type: "ears:test", action: "session" });
    },
  },
  metrics,
  speaker: {
    set muted(muted: boolean) {
      void earsTest({ type: "ears:test", action: "mute", muted });
    },
    get busy() {
      return earsTest<boolean>({ type: "ears:test", action: "speakerBusy" });
    },
  },
  resetConversation: () => toWorker({ type: "navi:test", action: "reset" }),
  lastReply: () => feed.lastReply(),
  get busy() {
    return worker.working;
  },
};
(window as unknown as { navi: typeof navi }).navi = navi;

/** Tells the background worker this panel is open, so the shortcut can close it. */
async function registerPanel() {
  const { id } = await chrome.windows.getCurrent();
  const port = chrome.runtime.connect({ name: `navi-panel:${id}` });
  port.onMessage.addListener((msg: { type?: string }) => {
    if (msg.type === "navi:close-panel") window.close();
  });
  // The worker restarts after being idle; reconnect so the shortcut keeps working.
  port.onDisconnect.addListener(() => window.setTimeout(() => void registerPanel(), 1000));
}

async function init() {
  void registerPanel().catch(() => undefined);
  if (__DEV__) {
    const devStatus = $("dev-status");
    devStatus.hidden = false;
    void startDevReload((text) => (devStatus.textContent = text));
  }
  applySettings(await loadSettings());
  onSettingsChanged(applySettings);
  const hello = await toWorker<WorkerHello>({ type: "navi:hello" }).catch(() => undefined);
  if (hello) {
    worker = hello.worker;
    ears = hello.ears;
    for (const m of hello.metrics) addMetric(m);
    feed.restore(hello.log as LogEntry[]);
  }
  void loadSpentToday();
  const granted = await checkMicPermission();
  void checkOnDeviceSpeech();
  // In "Hey Navi" mode, Navi listens for its name whenever it can.
  if (granted && settings.listenMode === "handsfree" && !worker.listening) void toWorker({ type: "navi:listen", on: true });
  renderStatus();
}

void init();
