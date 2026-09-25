// Side panel: microphone, wake-word session, status UI, and the command log.

import { startDevReload } from "../lib/dev-reload";
import type { CommandMetric } from "../lib/metrics";
import { MODEL_CATALOG } from "../lib/models";
import { parseCommand } from "../lib/parser";
import { routeUtterance } from "../lib/router";
import { WakeSession } from "../lib/session";
import { ScribeEngine } from "../lib/scribe";
import {
  DEFAULT_SETTINGS,
  type Settings,
  loadSettings,
  onSettingsChanged,
  keyFor,
  saveSettings,
  usesElevenInput,
  usesElevenOutput,
} from "../lib/settings";
import { type SpeechEngine, WebSpeechEngine, speechSupported } from "../lib/speech";
import { Speaker, earcons, setSoundVolume } from "../lib/voice-output";
import { Controller, HELP_TEXT, type LogKind } from "./controller";
import { Feed, type LogEntry } from "./feed";

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
  keyBanner: $("key-banner"),
  sessionBar: $("session-bar"),
  numbersButton: $<HTMLButtonElement>("toggle-numbers"),
  gridButton: $<HTMLButtonElement>("toggle-grid"),
};

let settings: Settings = DEFAULT_SETTINGS;
/** Chrome's recognizer: always on while listening (wake word, "stop" during replies, fallback). */
let engine: SpeechEngine | null = null;
/** ElevenLabs Scribe: transcribes commands while Navi is awake, when a key is set. */
let scribe: ScribeEngine | null = null;
/** ElevenLabs failed for good (bad key, quota); stay on Chrome's recognizer until settings change. */
let scribeDisabled = false;
let announcedScribe = false;
let working = false;
let micError = false;

const metrics: CommandMetric[] = [];
const session = new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 });
let lastVoiceError = "";
const speaker = new Speaker(
  () => ({
    rate: settings.speechRate,
    voiceName: settings.voiceName,
    lang: settings.lang,
    volume: settings.volume,
    eleven: usesElevenOutput(settings)
      ? { apiKey: settings.elevenLabsKey, voiceId: settings.elevenVoiceId, model: settings.elevenModel }
      : undefined,
  }),
  (message) => {
    if (message !== lastVoiceError) log("error", `Voice: ${message} Using Chrome's voice.`);
    lastVoiceError = message;
  },
);

// The log is kept for the browser session, so closing and reopening the panel doesn't wipe it.
// The feed groups it into one card per command (what you said, the steps, the result).
const LOG_KEY = "panelLog";
const feed = new Feed(ui.log, $("announcer"));
let logEntries: LogEntry[] = [];
let saveTimer: number | undefined;

function log(kind: LogKind, text: string, meta?: string) {
  logEntries = [...logEntries, feed.add(kind, text, meta)].slice(-200);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void chrome.storage.session.set({ [LOG_KEY]: logEntries }).catch(() => undefined), 300);
}

/** Shows the log from earlier in this browser session; false if there was none. */
async function restoreLog(): Promise<boolean> {
  const data: Record<string, unknown> = await chrome.storage.session.get(LOG_KEY).catch(() => ({}));
  const stored = data[LOG_KEY] as LogEntry[] | undefined;
  if (!stored?.length) return false;
  logEntries = [...stored, ...logEntries].slice(-200);
  feed.restore(logEntries);
  return true;
}

const controller = new Controller(
  () => settings,
  {
    log,
    setWorking(isWorking, detail) {
      working = isWorking;
      renderStatus(detail);
    },
    numbersShown(shown) {
      setToggle(ui.numbersButton, shown, shown ? "Hide flags" : "Flags");
    },
    gridShown(shown) {
      setToggle(ui.gridButton, shown, shown ? "Hide grid" : "Grid");
    },
  },
  speaker,
  {
    onSleep: () => goToSleep(),
    onActivity: () => session.touch(),
    onMetric: (metric) => metrics.push(metric),
  },
);

function renderStatus(detail?: string) {
  let state = "off";
  let text = "Mic off";
  if (micError) {
    state = "error";
    text = "Mic unavailable";
  } else if (working) {
    state = "working";
    text = detail ?? "Working…";
  } else if (engine?.running) {
    if (settings.listenMode === "open") {
      state = "awake";
      text = "Open mic: just say a command";
    } else if (session.current === "awake") {
      state = "awake";
      text = "Awake: just say a command";
    } else {
      state = "sleeping";
      text = `Say “Hey ${settings.wakeName}”`;
    }
  }
  showStatus(state, text, detail);
  const listening = !!engine?.running;
  ui.mic.setAttribute("aria-pressed", String(listening));
  ui.mic.setAttribute("aria-label", listening ? "Stop listening" : "Start listening");
  ui.mic.dataset.awake = String(listening && session.current === "awake" && settings.listenMode === "handsfree");
  renderSessionBar();
}

const STATUS_LABELS: Record<string, string> = {
  off: "Mic off",
  error: "Mic unavailable",
  working: "Working",
  awake: "Listening",
  sleeping: "Asleep",
};
const voiceCard = $("voice");
const captionHint = $("caption-hint");

/** Header pill (short, announced), the voice card's look, and the hint shown while nothing is being heard. */
function showStatus(state: string, text: string, detail?: string) {
  feed.setWorking(working, detail);
  ui.status.dataset.state = state;
  voiceCard.dataset.state = state;
  setText(ui.statusText, STATUS_LABELS[state] ?? text);
  const hint =
    state === "off" ? "Tap the mic to talk, or type a command below." : state === "working" ? feed.activity || text : text;
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
  const remaining = session.remainingMs;
  const show = !!engine?.running && settings.listenMode === "handsfree" && remaining > 0;
  ui.sessionBar.hidden = !show;
  if (show) {
    const pct = (remaining / (settings.sessionTimeoutSec * 1000)) * 100;
    (ui.sessionBar.firstElementChild as HTMLElement).style.width = `${pct}%`;
  }
}

let wasAwake = false;
window.setInterval(() => {
  // Detect the session timing out on its own.
  const awake = session.current === "awake";
  if (wasAwake && !awake && settings.listenMode === "handsfree" && engine?.running) {
    earcons.sleep();
    stopScribe();
    log("info", "Went to sleep. Say “Hey " + settings.wakeName + "” to wake me.");
  }
  wasAwake = awake;
  if (working) session.touch();
  renderStatus();
}, 1000);

function goToSleep() {
  // In open-mic mode, "go to sleep" turns the mic off.
  if (settings.listenMode === "open") {
    stopListening();
  } else {
    session.sleep();
    wasAwake = false;
    stopScribe();
    earcons.sleep();
  }
  renderStatus();
}

function handleFinal(transcript: string, confidence = 0) {
  ui.interim.textContent = "";
  if (speaker.busy) {
    // Let "stop" interrupt a long reply; ignore anything else (likely our own voice).
    if (/\b(stop|cancel|quiet)\b/i.test(transcript)) controller.cancel();
    return;
  }
  const decision = session.handle(transcript);
  if (decision.woke) {
    earcons.wake();
    wasAwake = true;
    startScribe();
    if (!decision.command) log("info", "I'm listening.");
  }
  if (decision.command) {
    void controller.run(decision.command, { source: "voice", confidence });
  }
  renderStatus();
}

/** True while ElevenLabs is the one transcribing commands. */
function scribeActive(): boolean {
  return !!scribe?.live;
}

/** Chrome's recognizer defers to ElevenLabs while it's active, except to hear "stop" during a reply. */
function handleChromeFinal(transcript: string, confidence: number) {
  if (!scribeActive()) return handleFinal(transcript, confidence);
  if (speaker.busy && /\b(stop|cancel|quiet)\b/i.test(transcript)) controller.cancel();
}

function handleInterim(text: string) {
  if (speaker.busy) return;
  const asleep = settings.listenMode === "handsfree" && session.current === "sleeping";
  // While asleep, only show speech once the wake word is heard (nothing else is acted on).
  const shown = asleep && !session.hearsWakePhrase(text) ? "" : text;
  // Keep a runaway transcript (e.g. noise heard as words) to a few readable lines, newest words in view.
  ui.interim.textContent = shown.length > 120 ? `…${shown.slice(-120)}` : shown;
  ui.interim.scrollTop = ui.interim.scrollHeight;
}

let lastSpeechInfo = "";

function buildEngine(): SpeechEngine {
  // No word boosting: it made Chrome "hear" boosted words in background noise ("testing" came out as
  // "hey navi wikipedia tiktok"). Misheard wake names ("navy", "nobby"...) are matched in the parser instead.
  return new WebSpeechEngine(
    { lang: settings.lang, preferOnDevice: true, allowCloud: settings.allowCloudSpeech },
    {
      onInterim: (text) => {
        if (!scribeActive()) handleInterim(text);
      },
      onFinal: handleChromeFinal,
      onRunningChange: () => renderStatus(),
      onError(message, fatal) {
        log("error", message);
        if (fatal) {
          micError = true;
          engine = null;
          void checkMicPermission();
        }
        renderStatus();
      },
      onInfo: (message) => {
        // Restarts (e.g. after a settings change) repeat the same notes; show each once.
        if (message !== lastSpeechInfo) log("info", message);
        lastSpeechInfo = message;
      },
    },
  );
}

/** Starts ElevenLabs transcription for an awake session (no-op without a key). */
function startScribe() {
  if (scribe || scribeDisabled || !usesElevenInput(settings) || !engine?.running) return;
  // Just the wake name: a long list of boosted words risks the same phantom words as Chrome's boosting did.
  const keyterms = [settings.wakeName, `Hey ${settings.wakeName}`];
  let lastError = "";
  const current = new ScribeEngine(
    {
      apiKey: settings.elevenLabsKey,
      lang: settings.lang,
      keyterms,
      filterBackgroundAudio: settings.filterBackgroundAudio,
      isMuted: () => speaker.busy,
    },
    {
      onInterim: handleInterim,
      onFinal: handleFinal,
      onRunningChange(running) {
        if (running && !announcedScribe) {
          announcedScribe = true;
          log("info", `Speech while awake: ElevenLabs${settings.filterBackgroundAudio ? ", ignoring background voices" : ""}.`);
        }
        renderStatus();
      },
      onError(message, fatal) {
        if (message !== lastError) log("error", fatal ? `${message} Using Chrome's speech recognition.` : message);
        lastError = message;
        if (fatal) {
          scribeDisabled = true;
          if (scribe === current) scribe = null;
          current.stop();
        }
        renderStatus();
      },
    },
  );
  scribe = current;
  void current.start();
}

function stopScribe() {
  scribe?.stop();
  scribe = null;
}

let listenGeneration = 0;

async function startListening() {
  if (!speechSupported()) {
    log("error", "Speech recognition isn't available in this browser.");
    return;
  }
  micError = false;
  const generation = ++listenGeneration;
  stopScribe();
  engine?.stop();
  const next = buildEngine();
  engine = next;
  await next.start();
  // A newer start or a stop happened meanwhile: never leave two recognizers running.
  if (generation !== listenGeneration) {
    next.stop();
    return;
  }
  if (settings.listenMode === "open") session.wake();
  if (settings.listenMode === "open" || session.current === "awake") startScribe();
  renderStatus();
}

function stopListening() {
  listenGeneration++;
  stopScribe();
  engine?.stop();
  engine = null;
  ui.interim.textContent = "";
  renderStatus();
}

let micGranted = false;

async function checkMicPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    micGranted = status.state === "granted";
    ui.micBanner.hidden = micGranted;
    status.onchange = () => {
      micGranted = status.state === "granted";
      ui.micBanner.hidden = micGranted;
      if (micGranted) micError = false;
      renderStatus();
    };
    return micGranted;
  } catch {
    micGranted = true;
    return true;
  }
}

function applySettings(next: Settings) {
  const speechChanged =
    next.elevenLabsKey !== settings.elevenLabsKey ||
    next.speechInput !== settings.speechInput ||
    next.filterBackgroundAudio !== settings.filterBackgroundAudio;
  const restart =
    engine?.running &&
    (speechChanged ||
      next.lang !== settings.lang ||
      next.wakeName !== settings.wakeName ||
      next.allowCloudSpeech !== settings.allowCloudSpeech ||
      next.listenMode !== settings.listenMode);
  // Choosing "Hey Navi" means Navi should be listening for its name, so turn the mic on.
  const startHandsFree = !engine?.running && micGranted && next.listenMode === "handsfree" && settings.listenMode !== "handsfree";
  if (speechChanged) scribeDisabled = false;
  if (next.elevenLabsKey !== settings.elevenLabsKey || next.elevenVoiceId !== settings.elevenVoiceId) lastVoiceError = "";
  settings = next;
  setSoundVolume(next.volume);
  session.configure({ mode: next.listenMode, wakeName: next.wakeName, timeoutSec: next.sessionTimeoutSec });
  document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) => (r.checked = r.value === next.listenMode));
  document.querySelectorAll(".wake-name").forEach((el) => (el.textContent = next.wakeName));
  ui.keyBanner.hidden = !!keyFor(next, next.model);
  if (restart || startHandsFree) void startListening();
  renderStatus();
}

function openSettings(e?: Event) {
  e?.preventDefault();
  void chrome.runtime.openOptionsPage();
}

ui.mic.addEventListener("click", () => {
  if (engine?.running) stopListening();
  else void startListening();
});

document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((radio) =>
  radio.addEventListener("change", () => void saveSettings({ listenMode: radio.value as Settings["listenMode"] })),
);

ui.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = ui.input.value;
  ui.input.value = "";
  // Typed commands skip the wake word.
  void controller.run(text);
});

$("open-setup").addEventListener("click", () => void chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") }));
$("open-settings").addEventListener("click", openSettings);
$("open-settings-inline").addEventListener("click", openSettings);
$("help").addEventListener("click", () => {
  log("navi", HELP_TEXT);
  void speaker.say(HELP_TEXT);
});
ui.gridButton.addEventListener("click", () => {
  controller.grid({ type: controller.gridShown ? "hide" : "show" }).catch((err: Error) => log("error", err.message));
});
ui.numbersButton.addEventListener("click", () => {
  controller.setNumbers(!controller.numbersShown).catch((err: Error) => log("error", err.message));
});

// Messages from the setup page.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg.type === "navi:mic-granted") {
    micError = false;
    ui.micBanner.hidden = true;
    renderStatus();
  }
});

// Exposed for automated tests and debugging from DevTools.
(window as unknown as { navi: unknown }).navi = {
  run: (text: string) => controller.run(text),
  handleFinal,
  chromeFinal: handleChromeFinal,
  /** Feeds ElevenLabs a tone at the given level for n x 100 ms, as if someone were talking. */
  feedScribe(level: number, chunks: number) {
    for (let i = 0; i < chunks; i++) {
      scribe?.feed(Float32Array.from({ length: 1600 }, (_, j) => level * Math.sin((2 * Math.PI * 220 * j) / 16000)));
    }
  },
  // For the router benchmark: one routing call with the current settings, timed.
  async route(text: string) {
    const t0 = performance.now();
    const result = await routeUtterance(text, { personalPhrases: [] }, settings, new AbortController().signal);
    return { ...result, ms: Math.round(performance.now() - t0) };
  },
  parse: (text: string) => parseCommand(text),
  models: MODEL_CATALOG,
  startListening,
  stopListening,
  get scribeLive() {
    return scribeActive();
  },
  session,
  metrics,
  speaker,
  resetConversation: () => controller.resetConversation(),
  lastReply: () => feed.lastReply(),
  get busy() {
    return controller.isBusy;
  },
};

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
  const restored = await restoreLog();
  applySettings(await loadSettings());
  onSettingsChanged(applySettings);
  const granted = await checkMicPermission();
  if (!restored) {
    log("info", `Hi! ${settings.listenMode === "handsfree" ? `Turn on the mic, then say “Hey ${settings.wakeName}”.` : "Click the mic and say a command."} Or type below.`);
  }
  if (granted && settings.listenMode === "handsfree") void startListening();
}

void init();
