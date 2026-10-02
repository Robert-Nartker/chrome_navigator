// Runs Navi in the background worker: the command controller (fast path, router, AI), the activity
// log, and the connection to Navi's ears (the offscreen document with the mic and voice). The side
// panel and the floating pill on pages are views of this, so Navi works with the panel closed.

import { routeUtterance } from "../lib/router";
import { naviWindowId, setFocusedWindowForTests, setPinnedWindow, sleep } from "../lib/browser";
import { closePanel, openPanel } from "./panels";
import { curateMemory, loadInbox, loadMemory, noteExchange } from "../lib/memory";
import { recordMetric } from "../lib/metrics";
import { formatCost } from "../lib/models";
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
import { DEFAULT_SETTINGS, type Settings, loadSettings, onSettingsChanged, activeSettings, saveSettings } from "../lib/settings";
import type { Voice } from "../lib/voice-output";
import { Controller, HELP_TEXT, type LogPlace } from "../sidepanel/controller";
import { ThreadBook } from "../lib/threads";
import { WindowPin } from "../lib/window-pin";
import { Helpers, describeHelper } from "../lib/helpers";

let settings: Settings = DEFAULT_SETTINGS;
let settingsLoaded: Promise<void> = Promise.resolve();
const metrics: CommandMetric[] = [];
const threads = new ThreadBook((state) => {
  broadcast({ type: "view:threads", state });
  logBook.keepThreads(state.threads.map((t) => t.id));
});
const logBook = new LogBook(threads.ready.then(() => threads.current));
const pin = new WindowPin((id, closed) => {
  setPinnedWindow(id);
  worker = { ...worker, pinnedWindow: id };
  broadcastWorker();
  if (closed) {
    const text = "Navi's window was closed, so Navi works in whichever window you're using again.";
    log("info", text, undefined, false);
    void voice.say(text);
  }
});
void pin.ready.then(() => {
  setPinnedWindow(pin.window);
  worker = { ...worker, pinnedWindow: pin.window };
  broadcastWorker();
});
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
    await Promise.race([ready, sleep(5000)]);
    await sendEars({ type: "ears:configure", settings });
  })().catch((err) => {
    earsReady = null;
    throw err;
  });
  return earsReady;
}

/**
 * Closes Navi's background page while Navi is off: the mic, the recognizers and every model in it
 * (Navi's voice, Parakeet, Gemini Nano sessions) are freed, so Navi off uses no memory to speak of.
 * Anything that needs it later (a typed reply spoken, Navi Free's chat) opens it again.
 */
async function closeEars() {
  clearTimeout(closeTimer);
  if (worker.listening || !(await earsExist())) return;
  // In use (dictating into the chat box, or talking): later.
  if (ears.listening || ears.speaking || ears.dictating) return closeEarsWhenIdle(30_000);
  earsReady = null;
  await chrome.offscreen.closeDocument().catch(() => undefined);
  ears = EARS_OFF;
  // Views hear it as the background page's last word.
  void chrome.runtime.sendMessage({ type: "ears:state", state: EARS_OFF } satisfies EarsEvent).catch(() => undefined);
  pushPill();
}
let closeTimer: ReturnType<typeof setTimeout> | undefined;
/** Used while Navi is off (e.g. a typed command's sound): closed again once it has been idle a while. */
function closeEarsWhenIdle(ms = 5 * 60_000) {
  clearTimeout(closeTimer);
  if (!worker.listening) closeTimer = setTimeout(() => void closeEars(), ms);
}

async function sendEars<T = unknown>(request: EarsRequest): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(request)) as T;
  } catch {
    // Not open (yet).
    return undefined;
  }
}

/**
 * Set when the user turns Navi off (the mic button, the shortcut, or "turn off"): no mic at all, across
 * Chrome restarts, until they turn it on again. Otherwise Navi is on, listening for its name from the moment
 * Chrome starts.
 */
const OFF_KEY = "naviOff";
/** Set once per Chrome session (session storage clears when Chrome closes). */
const SESSION_KEY = "naviSession";

/** `byUser`: an explicit on/off, remembered. Otherwise (resuming, a failed start) nothing is remembered. */
async function setListening(on: boolean, byUser = false) {
  if (byUser) await chrome.storage.local.set({ [OFF_KEY]: !on });
  worker = { ...worker, listening: on };
  broadcastWorker();
  // Push to talk: Navi is on, but the mic opens only when the shortcut is pressed.
  if (on && settings.listenMode === "push") {
    clearTimeout(closeTimer);
    if (await earsExist()) await sendEars({ type: "ears:listen", on: false });
    return;
  }
  if (on && !(await earsOrProblem())) {
    worker = { ...worker, listening: false };
    broadcastWorker();
    return;
  }
  if (on || (await earsExist())) await sendEars({ type: "ears:listen", on });
  if (on) clearTimeout(closeTimer);
  // Turned off: nothing stays loaded. (A moment's grace: turning it straight back on, as a restart does,
  // keeps what's loaded.)
  else if (byUser) closeEarsWhenIdle(2000);
}

async function turnedOff(): Promise<boolean> {
  return (await chrome.storage.local.get(OFF_KEY))[OFF_KEY] === true;
}

/** Whether the mic is allowed (unknown counts as yes: starting will say if it isn't). */
async function micAllowed(): Promise<boolean> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state === "granted";
  } catch {
    return true;
  }
}

/** Listens for the wake name, unless the user turned Navi off (or the mic isn't allowed yet). */
async function resume() {
  if (worker.listening || (await turnedOff()) || !(await micAllowed())) return;
  await setListening(true);
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

/** The last thing Navi said (tests ask after Navi's background page has closed). */
let lastSpoken = "";

const voice: Voice = {
  async say(text) {
    lastSpoken = text.replace(/[*_`#>]/g, "").trim() || lastSpoken;
    // Without a voice the reply is still in the log; the problem is reported once.
    if (await earsOrProblem()) await sendEars({ type: "ears:say", text });
    closeEarsWhenIdle();
  },
  stop() {
    void sendEars({ type: "ears:stop-speaking" });
  },
  sound(name) {
    void earsOrProblem().then((ok) => ok && sendEars({ type: "ears:sound", name }));
    closeEarsWhenIdle();
  },
};

/**
 * `onPage`: also show a reply or error in the caption on the page (not for speech-service hiccups).
 * Entries go to the thread of the command running now, else the current thread.
 */
function log(kind: LogKind, text: string, meta?: string, onPage = true, place: LogPlace = {}) {
  const entry = logBook.add(kind, text, meta, place.thread ?? threads.running ?? threads.current, place.solo);
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

const helpers = new Helpers({
  getSettings: () => activeSettings(settings),
  onChange(running) {
    worker = { ...worker, helpers: running };
    broadcastWorker();
  },
  onEnd(helper) {
    const ms = (helper.ended ?? Date.now()) - helper.started;
    log("info", describeHelper(helper), `Helper · ${helper.step} steps · ${(ms / 1000).toFixed(1)}s · ${formatCost(helper.costUsd)}`, false, {
      thread: helper.thread,
      solo: true,
    });
    const metric: CommandMetric = {
      t: new Date().toISOString(), command: `(helper) ${helper.task.slice(0, 80)}`, path: "background", intent: "helper",
      ms, steps: helper.step, model: helper.model, costUsd: helper.costUsd, error: helper.status === "done" ? undefined : helper.why,
    };
    addMetric(metric);
    void recordMetric(metric).catch(() => undefined);
    // Its report goes to the main AI, which tells the user.
    controller.helperEnded(helper);
  },
});

const controller = new Controller(
  // With only one provider's key, that provider's models run.
  () => activeSettings(settings),
  {
    log: (kind, text, meta, place) => log(kind, text, meta, true, place),
    setWorking(on, detail) {
      const turn = logBook.setWorking(on);
      worker = { ...worker, working: on, detail: on ? detail : undefined, turn };
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
    tutorial(view) {
      worker = { ...worker, tutorial: view };
      broadcastWorker();
    },
  },
  voice,
  {
    onSleep() {
      // In open-mic mode, "go to sleep" goes back to listening for the name.
      if (settings.listenMode === "open") void saveSettings({ listenMode: "handsfree" });
      else void sendEars({ type: "ears:session", action: "sleep" });
    },
    onTurnOff() {
      void setListening(false, true);
    },
    onActivity() {
      void sendEars({ type: "ears:session", action: "touch" });
    },
    onWake() {
      if (settings.listenMode !== "open") void sendEars({ type: "ears:session", action: "wake" });
    },
    onTutorialEnd() {
      void chrome.storage.local.set({ tutorialOffered: true });
    },
    async onPanel(open, windowId) {
      if (windowId === undefined) return "There's no window to open Navi's panel in.";
      if (!open) return (await closePanel(windowId)) ? "Closed Navi's panel" : "Navi's panel isn't open.";
      const how = await openPanel(windowId);
      return how === "already"
        ? "Navi's panel is already open."
        : how === "side"
          ? "Opened Navi's panel"
          : "Opened Navi's panel as a window (Chrome opens the side panel only from a click or a shortcut)";
    },
    onMetric(metric) {
      addMetric(metric);
    },
    onExchange(said, reply) {
      if (!activeSettings(settings).memory) return;
      void noteExchange(said, reply).then((waiting) => scheduleMemoryUpdate(waiting >= MEMORY_BATCH ? 5000 : MEMORY_IDLE_MS));
    },
  },
  threads,
  pin,
  helpers,
);

function addMetric(metric: CommandMetric) {
  metrics.push(metric);
  if (metrics.length > 500) metrics.shift();
  broadcast({ type: "view:metric", metric });
}

// ---------- Memory: updated in the background once Navi has been idle a while ----------

/** Navi idle this long after an AI conversation: time to update the memory. */
const MEMORY_IDLE_MS = 60_000;
/** This many new exchanges: update soon, idle or not. */
const MEMORY_BATCH = 10;
let memoryTimer: ReturnType<typeof setTimeout> | undefined;
let memoryUpdating: Promise<unknown> | null = null;

function scheduleMemoryUpdate(delayMs: number) {
  clearTimeout(memoryTimer);
  memoryTimer = setTimeout(() => void updateMemory(), delayMs);
}

/** Folds what was said into Navi's memory (never while a command runs, never two at once). */
async function updateMemory(): Promise<void> {
  if (memoryUpdating) return;
  if (worker.working) return scheduleMemoryUpdate(MEMORY_IDLE_MS);
  const active = activeSettings(settings);
  if (!active.memory) return;
  const started = performance.now();
  memoryUpdating = curateMemory(active, AbortSignal.timeout(60_000))
    .then((done) => {
      if (!done) return;
      const metric: CommandMetric = {
        t: new Date().toISOString(), command: "(memory update)", path: "background", intent: "memory",
        ms: Math.round(performance.now() - started), model: done.model, costUsd: done.costUsd,
      };
      addMetric(metric);
      void recordMetric(metric).catch(() => undefined);
    })
    .catch(() => scheduleMemoryUpdate(10 * MEMORY_IDLE_MS))
    .finally(() => (memoryUpdating = null));
  await memoryUpdating;
}

// ---------- Views: side panel, floating pill, toolbar badge ----------

function broadcast(event: ViewEvent) {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function broadcastWorker() {
  broadcast({ type: "view:worker", state: worker });
  pushPill();
}

let pillQueued = false;
/** The tab showing the pill. */
let pillTab: number | undefined;

/** The active tab in Navi's window: the one that shows the pill. */
async function naviTab(): Promise<chrome.tabs.Tab | undefined> {
  const win = await naviWindowId();
  const [tab] = await chrome.tabs.query(win !== undefined ? { active: true, windowId: win } : { active: true, lastFocusedWindow: true });
  return tab;
}

/**
 * Updates the pill and the toolbar badge (at most every 100 ms). The pill shows in the active tab of
 * Navi's window (where the command runs, or the pinned window), and leaves the tab that showed it before.
 */
function pushPill() {
  if (pillQueued) return;
  pillQueued = true;
  setTimeout(() => {
    pillQueued = false;
    void updateBadge();
    const update = pillState();
    void naviTab()
      .then((tab) => {
        if (pillTab !== undefined && pillTab !== tab?.id) chrome.tabs.sendMessage(pillTab, { ...update, away: true }).catch(() => undefined);
        pillTab = tab?.id;
        return tab?.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, update);
      })
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

/** Set when setup allows the mic: the first time Navi is listening, it offers the spoken tour. */
let offerTutorial = false;

function maybeOfferTutorial() {
  if (!offerTutorial || !ears.listening || ears.micError) return;
  offerTutorial = false;
  void offerTutorialOnce();
}

async function offerTutorialOnce() {
  if ((await chrome.storage.local.get("tutorialOffered")).tutorialOffered) return;
  await chrome.storage.local.set({ tutorialOffered: true });
  const name = settings.wakeName || "Navi";
  const how =
    settings.listenMode === "open"
      ? "say: start the tutorial"
      : settings.listenMode === "push"
        ? "press the push-to-talk shortcut and say: start the tutorial"
        : `say: Hey ${name}, start the tutorial`;
  controller.announce(`Hi, I'm ${name}, and I'm listening. For a two-minute tour of what I can do, ${how}.`);
}

type Message = EarsEvent | WorkerRequest | { type: "navi:mic-granted" } | { type: "pill:hello" } | { type?: undefined };

function onMessage(msg: Message, sendResponse: (response?: unknown) => void, sender?: chrome.runtime.MessageSender): boolean {
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
      void controller.run(msg.text, { source: "voice", alternatives: msg.alternatives });
      return false;
    case "ears:cancel":
      controller.cancel();
      return false;
    case "ears:state":
      ears = msg.state;
      pushPill();
      maybeOfferTutorial();
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
      void Promise.all([logBook.ready, threads.ready, settingsLoaded]).then(() => {
        if (!logBook.all.length) logBook.add("info", greeting(), undefined, threads.current);
        sendResponse({ worker, ears, log: logBook.all, metrics, threads: threads.state() } satisfies WorkerHello);
      });
      return true;
    case "navi:run":
      // Always answers: a view waiting on a reply that never comes gets "message channel closed".
      void controller
        .run(msg.text, { source: msg.source ?? "typed" })
        .catch((err: unknown) => log("error", `Something went wrong: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => sendResponse({ metrics }));
      return true;
    case "navi:dictate":
      void (async () => {
        if (await earsOrProblem()) await sendEars({ type: "ears:dictate", on: msg.on });
        closeEarsWhenIdle();
      })().finally(() => sendResponse(true));
      return true;
    case "ears:dictation":
      // For the side panel's chat box, which hears it directly.
      return false;
    case "navi:listen":
      void setListening(msg.on, true)
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
    case "navi:helper":
      if (msg.id === undefined) helpers.stopAll();
      else helpers.stop(msg.id);
      sendResponse(true);
      return false;
    case "navi:pin":
      void controller.pinWindow(msg.window).finally(() => sendResponse(true));
      return true;
    case "navi:thread":
      void threads.ready
        .then(() => controller.threadAction(msg.action, msg.id, msg.title))
        .finally(() => sendResponse(threads.state()));
      return true;
    case "navi:help":
      log("navi", HELP_TEXT);
      void voice.say(HELP_TEXT);
      sendResponse(true);
      return false;
    case "pill:hello":
      // A page just loaded: show the pill as it is now, if it's the page Navi is using.
      void naviTab().then(
        (tab) => sendResponse({ ...pillState(), away: !sender?.tab || sender.tab.id !== tab?.id }),
        () => sendResponse({ ...pillState(), away: true }),
      );
      return true;
    case "navi:mic-granted":
      // Setup just allowed the mic: start listening for the name, and once Navi hears, offer the tour.
      offerTutorial = true;
      void resume().then(maybeOfferTutorial);
      return false;
    case "navi:tutorial":
      void controller.tutorialAction(msg.action).finally(() => sendResponse(true));
      return true;
    case "navi:resume":
      // A view opened: listen if Navi is on but isn't yet (e.g. the mic was allowed in Chrome's settings).
      void resume().finally(() => sendResponse(true));
      return true;
    case "navi:test":
      void test(msg).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
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
  if (settings.listenMode === "open") return setListening(!worker.listening, true);
  if (settings.listenMode === "push") {
    // Push to talk: open the mic and listen for a command now; pressed again while listening, close it.
    if (!worker.listening) await setListening(true, true);
    if (!(await earsOrProblem())) return;
    await sendEars({ type: "ears:session", action: ears.listening ? "sleep" : "wake" });
    return;
  }
  if (!worker.listening) await setListening(true, true);
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
    settings.listenMode === "handsfree"
      ? `Say “Hey ${settings.wakeName}”, then a command.`
      : settings.listenMode === "push"
        ? "Press the push-to-talk shortcut (Ctrl+Space unless you changed it), then say a command."
        : "Click the mic and say a command.";
  return `${start} Or type below to ask Navi anything. Navi keeps listening when this panel is closed.`;
}

/** Hooks for automated tests and the benchmark (through the side panel's window.navi). */
async function test(msg: Extract<WorkerRequest, { type: "navi:test" }>): Promise<unknown> {
  switch (msg.action) {
    case "reset":
      controller.resetConversation();
      return true;
    case "memory":
      await updateMemory();
      return loadMemory();
    case "focus":
      setFocusedWindowForTests(msg.window);
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
      // Navi was turned off since (its background page closed): what it said last is still known.
      if (msg.ears?.action === "lastSaid" && !(await earsExist())) return lastSpoken;
      if (!(await earsOrProblem())) return undefined;
      return sendEars(msg.ears!);
  }
}

// Navi Free's on-device model lives in the background page.
setNanoTransport({
  async prompt(req) {
    if (!(await earsOrProblem())) throw new Error(worker.problem ?? "Navi's background page didn't start.");
    const res = await sendEars<{ text?: string; error?: string }>({ type: "nano:prompt", req });
    closeEarsWhenIdle();
    if (!res || res.error !== undefined || res.text === undefined) throw new Error(res?.error ?? "The on-device model didn't answer.");
    return res.text;
  },
  async status() {
    if (!(await earsOrProblem())) return "unsupported";
    closeEarsWhenIdle();
    return (await sendEars<NanoStatus>({ type: "nano:status" })) ?? "unsupported";
  },
});

export function startNavi() {
  // Having a startup listener makes Chrome start this worker with the browser, so Navi resumes
  // listening (below) without anyone opening its panel.
  chrome.runtime.onStartup.addListener(() => undefined);
  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => onMessage(msg, sendResponse, sender));
  chrome.tabs.onActivated.addListener(() => pushPill());
  chrome.windows.onFocusChanged.addListener(() => pushPill());
  settingsLoaded = loadSettings().then((loaded) => {
    settings = loaded;
  });
  void (async () => {
    await settingsLoaded;
    onSettingsChanged((next) => {
      const toHandsFree = next.listenMode === "handsfree" && settings.listenMode !== "handsfree";
      const pushChanged = (next.listenMode === "push") !== (settings.listenMode === "push");
      settings = next;
      // Into push to talk the mic closes until the shortcut; out of it, Navi (if on) listens again.
      if (pushChanged && worker.listening) void setListening(true);
      void earsExist().then((open) => open && sendEars({ type: "ears:configure", settings }));
      // Choosing "Hey Navi" means Navi should be listening for its name (unless it was turned off).
      if (toHandsFree) void resume();
      pushPill();
    });
    // A new Chrome session listens for the name: Open mic (every word a command) is only on when chosen.
    if (!(await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY]) {
      await chrome.storage.session.set({ [SESSION_KEY]: true });
      if (settings.listenMode === "open") await saveSettings({ listenMode: "handsfree" });
    }
    // Replaced by OFF_KEY (on unless turned off).
    void chrome.storage.local.remove("listening");
    await resume();
    if (!worker.listening && (await earsExist())) await earsOrProblem();
    void updateBadge();
    // Chrome may have stopped this worker before a memory update ran: it runs once Navi is idle again.
    if ((await loadInbox()).length) scheduleMemoryUpdate(MEMORY_IDLE_MS);
  })();
}
