// Runs Navi in the background worker: the command controller (fast path, router, AI), the activity
// log, and the connection to Navi's ears (the offscreen document with the mic and voice). The side
// panel and the floating pill on pages are views of this, so Navi works with the panel closed.

import { routeUtterance } from "../lib/router";
import { type NanoStatus, setNanoTransport } from "../lib/nano";
import { LogBook } from "../lib/logbook";
import {
  EARS_OFF,
  type EarsEvent,
  type EarsRequest,
  type EarsState,
  type LogKind,
  type PillUpdate,
  type ViewEvent,
  type WorkerHello,
  type WorkerRequest,
  type WorkerState,
} from "../lib/messages";
import type { CommandMetric } from "../lib/metrics";
import { DEFAULT_SETTINGS, type Settings, loadSettings, onSettingsChanged, activeSettings } from "../lib/settings";
import type { Voice } from "../lib/voice-output";
import { Controller, HELP_TEXT } from "../sidepanel/controller";

let settings: Settings = DEFAULT_SETTINGS;
let settingsLoaded: Promise<void> = Promise.resolve();
const metrics: CommandMetric[] = [];
const logBook = new LogBook();
let worker: WorkerState = { working: false, numbers: false, grid: false, listening: false };
let ears: EarsState = EARS_OFF;
let interim = "";
let reply: PillUpdate["reply"];
let replyTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- Ears (the offscreen document) ----------

let earsReady: Promise<void> | null = null;
let markReady: (() => void) | null = null;

async function earsExist(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

/** Opens Navi's background page if needed, and resolves once it can take requests. */
function ensureEars(): Promise<void> {
  earsReady ??= (async () => {
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    if (await earsExist()) {
      // Already open (e.g. this worker restarted): just bring it up to date.
      markReady?.();
    } else {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: "Listens for voice commands and speaks Navi's replies, so Navi works with its panel closed.",
      });
    }
    await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);
    await sendEars({ type: "ears:configure", settings });
  })().catch((err) => {
    earsReady = null;
    throw err;
  });
  return earsReady;
}

async function sendEars<T = unknown>(request: EarsRequest): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(request)) as T;
  } catch {
    // Not open (yet).
    return undefined;
  }
}

async function setListening(on: boolean) {
  worker = { ...worker, listening: on };
  broadcastWorker();
  await chrome.storage.local.set({ listening: on });
  if (on && !(await earsOrProblem())) {
    worker = { ...worker, listening: false };
    broadcastWorker();
    await chrome.storage.local.set({ listening: false });
    return;
  }
  if (on || (await earsExist())) await sendEars({ type: "ears:listen", on });
}

/** Opens the background page; if it can't, says why (once) and returns false. */
async function earsOrProblem(): Promise<boolean> {
  try {
    await ensureEars();
    if (worker.problem) {
      worker = { ...worker, problem: undefined };
      broadcastWorker();
    }
    return true;
  } catch (err) {
    const problem = earsProblem(err);
    if (problem !== worker.problem) log("error", problem);
    worker = { ...worker, problem };
    broadcastWorker();
    return false;
  }
}

/** Why the background page (mic and voice) couldn't open, in words the user can act on. */
function earsProblem(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/page failed to load/i.test(message)) {
    return "Navi's mic and voice page is missing from this build. Rebuild Navi (restart npm run dev), then reload it on chrome://extensions.";
  }
  return `Navi couldn't start its mic and voice: ${message}`;
}

// ---------- The controller ----------

const voice: Voice = {
  async say(text) {
    // Without a voice the reply is still in the log; the problem is reported once.
    if (await earsOrProblem()) await sendEars({ type: "ears:say", text });
  },
  stop() {
    void sendEars({ type: "ears:stop-speaking" });
  },
  sound(name) {
    void earsOrProblem().then((ok) => ok && sendEars({ type: "ears:sound", name }));
  },
};

/** `onPage`: also show a reply or error in the caption on the page (not for speech-service hiccups). */
function log(kind: LogKind, text: string, meta?: string, onPage = true) {
  const entry = logBook.add(kind, text, meta);
  broadcast({ type: "view:log", entry });
  if (onPage && (kind === "navi" || kind === "error")) {
    reply = { kind, text };
    clearTimeout(replyTimer);
    // Long enough to read: longer replies stay longer (up to half a minute).
    replyTimer = setTimeout(() => {
      reply = undefined;
      pushPill();
    }, Math.min(30_000, 5000 + text.length * 60));
    pushPill();
  }
}

const controller = new Controller(
  // With only one provider's key, that provider's models run.
  () => activeSettings(settings),
  {
    log,
    setWorking(on, detail) {
      logBook.setWorking(on);
      worker = { ...worker, working: on, detail: on ? detail : undefined };
      broadcastWorker();
    },
    numbersShown(shown) {
      worker = { ...worker, numbers: shown };
      broadcastWorker();
    },
    gridShown(shown) {
      worker = { ...worker, grid: shown };
      broadcastWorker();
    },
  },
  voice,
  {
    onSleep() {
      // In open-mic mode, "go to sleep" turns the mic off.
      if (settings.listenMode === "open") void setListening(false);
      else void sendEars({ type: "ears:session", action: "sleep" });
    },
    onActivity() {
      void sendEars({ type: "ears:session", action: "touch" });
    },
    onMetric(metric) {
      metrics.push(metric);
      if (metrics.length > 500) metrics.shift();
      broadcast({ type: "view:metric", metric });
    },
  },
);

// ---------- Views: side panel, floating pill, toolbar badge ----------

function broadcast(event: ViewEvent) {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function broadcastWorker() {
  broadcast({ type: "view:worker", state: worker });
  pushPill();
}

let pillQueued = false;

/** Updates the pill in the active tab and the toolbar badge (at most every 100 ms). */
function pushPill() {
  if (pillQueued) return;
  pillQueued = true;
  setTimeout(() => {
    pillQueued = false;
    void updateBadge();
    const update = pillState();
    void chrome.tabs
      .query({ active: true, lastFocusedWindow: true })
      .then(([tab]) => (tab?.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, update)))
      .catch(() => undefined);
  }, 100);
}

function pillState(): PillUpdate {
  return { type: "pill:update", ears, worker, interim, reply, wakeName: settings.wakeName, mode: settings.listenMode };
}

async function updateBadge() {
  const [text, color] = ears.micError
    ? ["!", "#d93025"]
    : worker.working
      ? ["…", "#4f6ef7"]
      : ears.awake
        ? ["ON", "#1e8e3e"]
        : ears.listening
          ? ["zz", "#80868b"]
          : ["", "#80868b"];
  await chrome.action.setBadgeText({ text }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined);
}

// ---------- Messages ----------

type Message = EarsEvent | WorkerRequest | { type: "navi:mic-granted" } | { type: "pill:hello" } | { type?: undefined };

function onMessage(msg: Message, sendResponse: (response?: unknown) => void): boolean {
  switch (msg.type) {
    case "ears:ready":
      markReady?.();
      // A reloaded background page starts fresh: tell it what to do.
      void (async () => {
        await sendEars({ type: "ears:configure", settings });
        if (worker.listening) await sendEars({ type: "ears:listen", on: true });
      })();
      return false;
    case "ears:command":
      void controller.run(msg.text, { source: "voice", confidence: msg.confidence });
      return false;
    case "ears:cancel":
      controller.cancel();
      return false;
    case "ears:state":
      ears = msg.state;
      pushPill();
      return false;
    case "ears:interim":
      interim = msg.text;
      pushPill();
      return false;
    case "ears:log":
      // Retries and fallbacks go to the log only; a lasting mic problem shows on the page as the mic error.
      log(msg.kind, msg.text, undefined, false);
      return false;
    case "ears:heartbeat":
      return false;
    case "navi:hello":
      void Promise.all([logBook.ready, settingsLoaded]).then(() => {
        if (!logBook.all.length) logBook.add("info", greeting());
        sendResponse({ worker, ears, log: logBook.all, metrics } satisfies WorkerHello);
      });
      return true;
    case "navi:run":
      void controller.run(msg.text, { source: msg.source ?? "typed" }).then(() => sendResponse({ metrics }));
      return true;
    case "navi:dictate":
      void (async () => {
        if (await earsOrProblem()) await sendEars({ type: "ears:dictate", on: msg.on });
      })().finally(() => sendResponse(true));
      return true;
    case "ears:dictation":
      // For the side panel's chat box, which hears it directly.
      return false;
    case "navi:listen":
      void setListening(msg.on)
        .catch((err: unknown) => log("error", `Couldn't turn the mic ${msg.on ? "on" : "off"}: ${String(err)}`))
        .finally(() => sendResponse(true));
      return true;
    case "navi:toggle": {
      const done = () => sendResponse(true);
      const fail = (err: Error) => {
        log("error", err.message);
        done();
      };
      if (msg.what === "grid") controller.grid({ type: controller.gridShown ? "hide" : "show" }).then(done, fail);
      else controller.setNumbers(!controller.numbersShown).then(done, fail);
      return true;
    }
    case "navi:help":
      log("navi", HELP_TEXT);
      void voice.say(HELP_TEXT);
      sendResponse(true);
      return false;
    case "pill:hello":
      // A page just loaded: show the pill as it is now.
      sendResponse(pillState());
      return false;
    case "navi:mic-granted":
      // Setup just allowed the mic: start listening for the name.
      if (settings.listenMode === "handsfree" && !worker.listening) void setListening(true);
      return false;
    case "navi:test":
      void test(msg).then(sendResponse);
      return true;
    default:
      return false;
  }
}

/**
 * The "talk to Navi" shortcut: wakes Navi (turning the mic on if needed) so the next thing said is a
 * command, or puts it back to sleep. In open-mic mode it turns the mic on or off.
 */
export async function toggleWake() {
  if (settings.listenMode === "open") return setListening(!worker.listening);
  if (!worker.listening) await setListening(true);
  if (!worker.listening) return; // the mic couldn't start (the reason is logged)
  await sendEars({ type: "ears:session", action: ears.awake ? "sleep" : "wake" });
}

/** A message typed without the panel (the address bar's "navi" keyword): replies show on the page. */
export function runTyped(text: string) {
  void controller.run(text, { source: "typed" });
}

/** The first note in a fresh log. */
function greeting(): string {
  const start =
    settings.listenMode === "handsfree" ? `Say “Hey ${settings.wakeName}”, then a command.` : "Click the mic and say a command.";
  return `${start} Or type below to ask Navi anything. Navi keeps listening when this panel is closed.`;
}

/** Hooks for automated tests and the benchmark (through the side panel's window.navi). */
async function test(msg: Extract<WorkerRequest, { type: "navi:test" }>): Promise<unknown> {
  switch (msg.action) {
    case "reset":
      controller.resetConversation();
      return true;
    case "wake":
      await toggleWake();
      return true;
    case "busy":
      return controller.isBusy;
    case "route": {
      const t0 = performance.now();
      const result = await routeUtterance(
        msg.text ?? "",
        { personalPhrases: [], recent: msg.recent },
        activeSettings(settings),
        new AbortController().signal,
      );
      return { ...result, ms: Math.round(performance.now() - t0) };
    }
    case "ears":
      if (!(await earsOrProblem())) return undefined;
      return sendEars(msg.ears!);
  }
}

// Navi Free's on-device model lives in the background page.
setNanoTransport({
  async prompt(req) {
    if (!(await earsOrProblem())) throw new Error(worker.problem ?? "Navi's background page didn't start.");
    const res = await sendEars<{ text?: string; error?: string }>({ type: "nano:prompt", req });
    if (!res || res.error !== undefined || res.text === undefined) throw new Error(res?.error ?? "The on-device model didn't answer.");
    return res.text;
  },
  async status() {
    if (!(await earsOrProblem())) return "unsupported";
    return (await sendEars<NanoStatus>({ type: "nano:status" })) ?? "unsupported";
  },
});

export function startNavi() {
  // Having a startup listener makes Chrome start this worker with the browser, so Navi resumes
  // listening (below) without anyone opening its panel.
  chrome.runtime.onStartup.addListener(() => undefined);
  chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => onMessage(msg, sendResponse));
  chrome.tabs.onActivated.addListener(() => pushPill());
  chrome.windows.onFocusChanged.addListener(() => pushPill());
  settingsLoaded = loadSettings().then((loaded) => {
    settings = loaded;
  });
  void (async () => {
    await settingsLoaded;
    onSettingsChanged((next) => {
      const toHandsFree = next.listenMode === "handsfree" && settings.listenMode !== "handsfree";
      settings = next;
      void earsExist().then((open) => open && sendEars({ type: "ears:configure", settings }));
      // Choosing "Hey Navi" means Navi should be listening for its name.
      if (toHandsFree && !worker.listening) void setListening(true);
      pushPill();
    });
    const stored = await chrome.storage.local.get("listening");
    if (stored.listening) await setListening(true);
    else if (await earsExist()) await earsOrProblem();
    void updateBadge();
  })();
}
