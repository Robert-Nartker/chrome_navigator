// Side panel: microphone, wake-word session, status UI, and the command log.

import type { CommandMetric } from "../lib/metrics";
import { SITES } from "../lib/sites";
import { WakeSession } from "../lib/session";
import { DEFAULT_SETTINGS, type Settings, loadSettings, onSettingsChanged, saveSettings } from "../lib/settings";
import { type SpeechEngine, WebSpeechEngine, speechSupported } from "../lib/speech";
import { Speaker, earcons } from "../lib/voice-output";
import { Controller, HELP_TEXT, type LogKind } from "./controller";

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
};

let settings: Settings = DEFAULT_SETTINGS;
let engine: SpeechEngine | null = null;
let working = false;
let micError = false;

const metrics: CommandMetric[] = [];
const session = new WakeSession({ mode: "handsfree", wakeName: "Navi", timeoutSec: 120 });
const speaker = new Speaker(() => ({ rate: settings.speechRate, voiceName: settings.voiceName, lang: settings.lang }));

function log(kind: LogKind, text: string, meta?: string) {
  const li = document.createElement("li");
  li.className = kind;
  li.textContent = text;
  if (meta) {
    const span = document.createElement("span");
    span.className = "meta";
    span.textContent = meta;
    li.append(span);
  }
  ui.log.append(li);
  while (ui.log.children.length > 200) ui.log.firstElementChild?.remove();
  ui.log.scrollTop = ui.log.scrollHeight;
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
      ui.numbersButton.textContent = shown ? "Hide numbers" : "Show numbers";
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
    if (settings.listenMode === "push") {
      state = "awake";
      text = "Listening…";
    } else if (session.current === "awake") {
      state = "awake";
      text = "Awake: just say a command";
    } else {
      state = "sleeping";
      text = `Say “Hey ${settings.wakeName}”`;
    }
  }
  ui.status.dataset.state = state;
  ui.statusText.textContent = text;
  const listening = !!engine?.running;
  ui.mic.setAttribute("aria-pressed", String(listening));
  ui.mic.setAttribute("aria-label", listening ? "Stop listening" : "Start listening");
  ui.mic.dataset.awake = String(listening && session.current === "awake" && settings.listenMode === "handsfree");
  renderSessionBar();
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
    log("info", "Went to sleep. Say “Hey " + settings.wakeName + "” to wake me.");
  }
  wasAwake = awake;
  if (working) session.touch();
  renderStatus();
}, 1000);

function goToSleep() {
  if (settings.listenMode === "push") {
    stopListening();
  } else {
    session.sleep();
    wasAwake = false;
    earcons.sleep();
  }
  renderStatus();
}

function handleFinal(transcript: string) {
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
    if (!decision.command) log("info", "I'm listening.");
  }
  if (decision.command) {
    void controller.run(decision.command);
    if (settings.listenMode === "push") stopListening();
  }
  renderStatus();
}

function handleInterim(text: string) {
  if (speaker.busy) return;
  const asleep = settings.listenMode === "handsfree" && session.current === "sleeping";
  // While asleep, only show speech once the wake word is heard (nothing else is acted on).
  ui.interim.textContent = asleep && !session.hearsWakePhrase(text) ? "" : text;
}

function buildEngine(): SpeechEngine {
  const phrases = [settings.wakeName, `Hey ${settings.wakeName}`, ...Object.keys(SITES).slice(0, 40)];
  return new WebSpeechEngine(
    { lang: settings.lang, preferOnDevice: true, allowCloud: settings.allowCloudSpeech, phrases },
    {
      onInterim: handleInterim,
      onFinal: handleFinal,
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
      onInfo: (message) => log("info", message),
    },
  );
}

async function startListening() {
  if (!speechSupported()) {
    log("error", "Speech recognition isn't available in this browser.");
    return;
  }
  micError = false;
  engine?.stop();
  engine = buildEngine();
  await engine.start();
  if (settings.listenMode === "push") session.wake();
  renderStatus();
}

function stopListening() {
  engine?.stop();
  engine = null;
  ui.interim.textContent = "";
  renderStatus();
}

async function checkMicPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    const granted = status.state === "granted";
    ui.micBanner.hidden = granted;
    status.onchange = () => {
      ui.micBanner.hidden = status.state === "granted";
      if (status.state === "granted") micError = false;
      renderStatus();
    };
    return granted;
  } catch {
    return true;
  }
}

function applySettings(next: Settings) {
  const restart =
    engine?.running &&
    (next.lang !== settings.lang || next.wakeName !== settings.wakeName || next.allowCloudSpeech !== settings.allowCloudSpeech);
  settings = next;
  session.configure({ mode: next.listenMode, wakeName: next.wakeName, timeoutSec: next.sessionTimeoutSec });
  document.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((r) => (r.checked = r.value === next.listenMode));
  document.querySelectorAll(".wake-name").forEach((el) => (el.textContent = next.wakeName));
  ui.keyBanner.hidden = !!next.apiKey;
  if (restart) void startListening();
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
ui.numbersButton.addEventListener("click", () => {
  controller.setNumbers(!controller.numbersShown).catch((err: Error) => log("error", err.message));
});

// Messages from the background worker (keyboard shortcut) and the setup page.
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg.type === "navi:toggle-listening") {
    if (engine?.running) stopListening();
    else void startListening();
  } else if (msg.type === "navi:mic-granted") {
    micError = false;
    ui.micBanner.hidden = true;
    renderStatus();
  }
});

// Exposed for automated tests and debugging from DevTools.
(window as unknown as { navi: unknown }).navi = {
  run: (text: string) => controller.run(text),
  handleFinal,
  session,
  metrics,
  speaker,
  resetConversation: () => controller.resetConversation(),
  lastReply: () => {
    const replies = ui.log.querySelectorAll("li.navi");
    return replies[replies.length - 1]?.firstChild?.textContent ?? "";
  },
  get busy() {
    return controller.isBusy;
  },
};

async function init() {
  applySettings(await loadSettings());
  onSettingsChanged(applySettings);
  const granted = await checkMicPermission();
  log("info", `Hi! ${settings.listenMode === "handsfree" ? `Turn on the mic, then say “Hey ${settings.wakeName}”.` : "Click the mic and say a command."} Or type below.`);
  if (granted && settings.listenMode === "handsfree") void startListening();
}

void init();
