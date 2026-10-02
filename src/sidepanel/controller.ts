// Runs a command in Navi's background worker: personal and built-in commands first (instant, no AI), then
// the router, then the AI (GPT or Claude with a key; Gemini Nano on Navi Free).

import { type AgentResult, NaviAgent } from "../lib/agent";
import {
  activateTab,
  cycleTab,
  findTab,
  focusedWindowId,
  setWorkWindow,
  matchingTabs,
  hostOf,
  isWebUrl,
  listTabs,
  goBack,
  moveTab,
  naviWindowId,
  pickSearchBox,
  tabsWithUnsavedTyping,
  navigate,
  pageRequest,
  sleep,
  snapshot,
  targetTab,
  waitForLoad,
  zoom,
} from "../lib/browser";
import {
  type CommandMatch,
  type CustomCommand,
  MAX_DEPTH,
  deleteCommand,
  describeCommand,
  fillStep,
  isListCommandsRequest,
  loadCommands,
  matchCommand,
  onCommandsChanged,
  saveCommand,
} from "../lib/custom-commands";
import { freeChat } from "../lib/free-chat";
import { NANO_STATUS_TEXT, nanoStatusRemote } from "../lib/nano";
import { bestMatch } from "../lib/match";
import { loadMemory, memoryBlock } from "../lib/memory";
import { type CommandMetric, recordMetric } from "../lib/metrics";
import { NO_USAGE, formatCost } from "../lib/models";
import { type GridCommand, type Intent, parseBareNumber, parseCommand, parseGridCommand } from "../lib/parser";
import { type RecentCommand, routeUtterance } from "../lib/router";
import { FREE_MODEL, type Settings, isBlocked, keyFor, saveSettings } from "../lib/settings";
import { searchUrl, siteEngine } from "../lib/sites";
import { type ThreadBook, findThread, threadTitle, threadTranscript } from "../lib/threads";
import type { WindowPin } from "../lib/window-pin";
import { type HelperInfo, type Helpers, describeHelper } from "../lib/helpers";
import type { HelperApi } from "../lib/agent";
import { Tutorial, type TutorialControl, type TutorialEvent, type TutorialView, parseTutorialControl } from "../lib/tutorial";
import type { Voice } from "../lib/voice-output";

import type { LogKind } from "../lib/messages";

/** Where a log entry goes: by default the thread of the command running now (else the current one). */
export interface LogPlace {
  thread?: string;
  /** A note of its own, not part of the command running now. */
  solo?: boolean;
}

export interface ControllerUi {
  log(kind: LogKind, text: string, meta?: string, place?: LogPlace): void;
  setWorking(working: boolean, detail?: string): void;
  numbersShown(shown: boolean): void;
  gridShown?(shown: boolean): void;
  /** The tutorial's current step (undefined: not running). */
  tutorial?(view: TutorialView | undefined): void;
}

export const HELP_TEXT =
  "Try: scroll down, go back, open YouTube, search for pizza near me, new tab, close tab, flags, click 5, click sign in, type hello, read this page, describe the screen, or ask anything like: open my latest email. For anything hard to name, say show grid, then numbers to zoom in, then click. Make your own shortcuts by saying: add a command open wordle. Start a separate conversation with new thread, and come back with previous thread. Say go to sleep when you're done, or turn off to stop listening completely. For a spoken tour, say start the tutorial.";

/** What the AI is asked for "describe the screen". */
const DESCRIBE_SCREEN =
  "Describe what's on my screen for someone who can't see it. Look at the screen first. Say what page this is, what its main content is, and the main things I can do here, in under 80 words. Don't click or change anything.";

/** The fast path couldn't do it; the AI gets a try. `message` is used if there's no AI. */
class Unhandled extends Error {}

/** Commands that close or clear something "reopen tab" or "undo" can't fully bring back. */
function isDestructive(intent: Intent): boolean {
  return intent.type === "closeOtherTabs" || (intent.type === "edit" && intent.action === "clear");
}

/** Words that mean the user is asking about what's visible, so Navi Free looks at a screenshot. */
const SCREEN_WORDS = /\b(screen|see|look|looks|picture|image|photo|describe|showing|shown|visible)\b/i;

export interface RunOptions {
  /** Spoken, typed in the chat box, a step of a personal command, or helpers reporting back to the AI. */
  source: "voice" | "typed" | "step" | "helper";
  /** Skip the router (already interpreted, or a step of a personal command). */
  routed?: boolean;
  /** Only run built-in or personal commands; never fall through to the AI. */
  fastOnly?: boolean;
  /** The thread it was said in (default: the current one). */
  thread?: string;
  /** The window it acts in: Navi's pinned window, else the one it was given in. */
  window?: number;
  /** The recognizer's other guesses at what was said, best first. */
  alternatives?: string[];
}

/** Commands about threads and Navi's window: they run right away, even while another command runs. */
type InstantIntent = Extract<
  Intent,
  { type: "newThread" | "switchThread" | "listThreads" | "renameThread" | "pinWindow" | "stopHelpers" | "listHelpers" }
>;

const INSTANT = new Set(["newThread", "switchThread", "listThreads", "renameThread", "pinWindow", "stopHelpers", "listHelpers"]);
const isInstant = (intent: Intent | null): intent is InstantIntent => !!intent && INSTANT.has(intent.type);

interface Outcome {
  intent?: string;
  routerMs?: number;
  routerCostUsd?: number;
  /** Set when the AI handled (part of) the command. */
  agent?: AgentResult;
}

export class Controller {
  private readonly agent: NaviAgent;
  private current: AbortController | null = null;
  private queue: { text: string; options: RunOptions }[] = [];
  /** A close waiting for the user's yes, because it would lose typing that isn't sent or saved. */
  private pendingClose: { intent: Intent; until: number } | null = null;
  private busy = false;
  private numbers = false;
  private commands: CustomCommand[] = [];
  private gridOn = false;
  private autoScrolling = false;
  /** Last thing Navi said or showed, for "what did you say?". */
  private lastMessage = "";
  /** What Navi showed for the command running now. */
  private turnMessage = "";
  /** Each thread's last few commands and what came of them, so the AI can answer "why did that fail?". */
  private recentByThread = new Map<string, string[]>();
  /** The same, in brief, for the router ("again", "a bit more" and other follow-ups). */
  private recentForRouter: RecentCommand[] = [];
  /** Speech in order: an early answer finishes before the final reply starts. */
  private speech: Promise<void> = Promise.resolve();
  /** Bumped by "stop", so queued speech is dropped. */
  private speechGen = 0;
  private readonly tutorial = new Tutorial();

  constructor(
    private readonly getSettings: () => Settings,
    private readonly ui: ControllerUi,
    readonly speaker: Voice,
    private readonly hooks: {
      onSleep(): void;
      onTurnOff(): void;
      onActivity(): void;
      onMetric?(metric: CommandMetric): void;
      /** Something said to the AI and its reply (for memory). */
      onExchange?(said: string, reply: string): void;
      /** Wake the hands-free session, so the next thing said needs no wake name. */
      onWake?(): void;
      /** The tutorial ended (`finished`: the user got to the end). */
      onTutorialEnd?(finished: boolean): void;
      /** Opens or closes Navi's side panel in a window; returns what to say. */
      onPanel?(open: boolean, windowId: number | undefined): Promise<string>;
    },
    private readonly threads: ThreadBook,
    private readonly pin: WindowPin,
    private readonly helpers: Helpers,
  ) {
    this.agent = new NaviAgent(getSettings);
    const refresh = () =>
      void loadCommands()
        .then((commands) => (this.commands = commands))
        .catch(() => undefined);
    refresh();
    onCommandsChanged(refresh);
  }

  get isBusy() {
    return this.busy;
  }

  /** Forgets the AI conversation (e.g. between benchmark tasks). */
  resetConversation() {
    this.agent.reset();
  }

  /**
   * A helper ended: its report goes to the AI in the thread it was started from, once Navi is free
   * (several that end close together are reported in one go).
   */
  helperEnded(helper: HelperInfo) {
    void this.run(`Helper ${helper.id} ${helper.status === "done" ? "finished" : helper.status}`, { source: "helper", thread: helper.thread });
  }

  /** Stops whatever Navi is doing or saying. */
  cancel() {
    this.queue = [];
    if (this.autoScrolling) void this.autoScroll("stop").catch(() => undefined);
    this.current?.abort();
    this.speechGen++;
    this.speaker.stop();
    if (this.gridOn) void this.grid({ type: "hide" }).catch(() => undefined);
  }

  get gridShown() {
    return this.gridOn;
  }

  /** Mouse grid: show, zoom into blocks, zoom out, click, or hide. */
  async grid(command: GridCommand): Promise<string> {
    const tab = await targetTab();
    let image: string | undefined;
    if (command.type === "show") {
      // Number tags and the grid both answer to numbers, so only one shows at a time.
      if (this.numbers) {
        await this.setNumbers(false);
        await sleep(60); // let the page repaint before the picture
      }
      if (!this.gridOn) image = await this.gridPicture(tab);
    }
    let shown = false;
    try {
      const cells = "cells" in command ? command.cells : undefined;
      const res = await pageRequest(tab, { kind: "grid", action: command.type, cells, image });
      shown = !!res.gridActive;
      return res.detail ?? "";
    } finally {
      // On failure (the page reloaded, or can't show a grid) numbers stop going to the grid.
      this.gridOn = shown;
      this.ui.gridShown?.(shown);
    }
  }

  /** A picture of the visible tab for the grid's magnifier. It only goes to that tab, never to an AI. */
  private async gridPicture(tab: chrome.tabs.Tab): Promise<string | undefined> {
    if (!tab.active) return undefined; // Chrome can only picture the tab on screen
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
  }

  async run(text: string, options: RunOptions = { source: "typed" }): Promise<void> {
    const heard = text.trim();
    const command = this.bestGuess(heard, options.alternatives);
    if (!command) return;
    const fromHelper = options.source === "helper";
    const intent = fromHelper ? null : parseCommand(command);
    if (intent?.type === "stop") {
      this.ui.log("user", command);
      this.cancel();
      this.tutorialSaw({ command, intent: "stop" });
      return;
    }
    // The tutorial's own words: "next", "repeat", "end tutorial", and yes or no to its question.
    const control =
      this.tutorial.active && (options.source === "voice" || options.source === "typed")
        ? parseTutorialControl(command, !this.tutorial.step?.done)
        : null;
    if (control) {
      this.ui.log("user", command);
      await this.tutorialAction(control);
      return;
    }
    await Promise.all([this.threads.ready, this.pin.ready]);
    // Threads and pinning don't wait: a command already running finishes in its own thread and window.
    if (isInstant(intent) && options.source !== "step") {
      await this.instantCommandNow(intent, command, options);
      return;
    }
    // The window the command acts in, decided now: the user may move to another window meanwhile.
    const windowId = options.window ?? this.pin.window ?? (await focusedWindowId());
    if (this.busy) {
      // Commands spoken while Navi is working run in order afterwards, in the thread and window they were given in.
      const thread = options.thread ?? this.threads.current;
      if (fromHelper) this.queue.push({ text: command, options: { ...options, thread, window: windowId } });
      else if (this.queue.length < 5) {
        this.queue.push({ text: command, options: { ...options, thread, window: windowId } });
        this.ui.log("info", `Next: “${command}”`, undefined, { thread, solo: thread !== this.threads.running });
      }
      return;
    }
    const thread = this.threads.get(options.thread) ? options.thread! : this.threads.current;
    this.threads.running = thread;
    if (!fromHelper) this.threads.noteTurn(thread, command);
    this.agent.useThread(thread);
    setWorkWindow(windowId);
    if (!fromHelper) this.ui.log("user", command);
    if (command !== heard) this.ui.log("step", `Heard “${heard}”, which sounds like “${command}”`);
    this.busy = true;
    this.turnMessage = "";
    this.ui.setWorking(true);
    const controller = new AbortController();
    this.current = controller;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let metric: Omit<CommandMetric, "t" | "command"> | null = null;
    let reply: string | null = null;
    let confirmation = false;
    try {
      const outcome = fromHelper ? await this.helperReport(thread, controller.signal) : await this.dispatch(command, controller.signal, 0, options);
      const routerCost = outcome.routerCostUsd ?? 0;
      if (outcome.agent) {
        const { agent } = outcome;
        metric = {
          path: "ai", intent: outcome.intent, ms: elapsed(), modelMs: agent.modelMs, steps: agent.steps,
          model: agent.model, routerMs: outcome.routerMs, costUsd: agent.costUsd + routerCost,
          tokensIn: agent.usage.input + agent.usage.cachedInput + agent.usage.cacheWrite, tokensOut: agent.usage.output,
        };
        reply = agent.reply;
        confirmation = !!agent.confirmation;
      } else if (outcome.intent === "ignored" || outcome.intent === "unknown") {
        metric = { path: "ignored", intent: outcome.intent, ms: elapsed(), routerMs: outcome.routerMs, costUsd: routerCost };
      } else {
        metric = { path: "fast", intent: outcome.intent, ms: elapsed(), routerMs: outcome.routerMs, costUsd: routerCost };
        this.ui.log("step", `${outcome.routerMs ? "Routed" : "Fast path"} · ${metric.ms} ms`);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        metric = { path: "cancelled", ms: elapsed() };
        this.ui.log("info", "Cancelled.");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        metric = { path: "error", ms: elapsed(), error: message };
        this.ui.log("error", message);
        // Errors are a sound by default; the full message is in the log (and spoken in spoken mode).
        this.speaker.sound("error");
        if (this.getSettings().feedback === "spoken") reply = message;
      }
    } finally {
      if (metric) {
        if (options.source === "voice" || options.source === "typed") this.tutorialSaw({ command, intent: metric.intent, path: metric.path });
        const row: CommandMetric = { t: new Date().toISOString(), command, ...metric };
        this.hooks.onMetric?.(row);
        void recordMetric(row).catch(() => undefined);
        this.remember(command, options, metric);
        if (metric.path === "ai" && reply) {
          // Helper reports are web content, so they never go into Navi's memory of the user.
          if (!fromHelper) this.hooks.onExchange?.(command, reply);
          this.threads.noteExchange(thread, fromHelper ? `(helpers reported) ${command}` : command, reply);
        }
      }
      // Speak after timing, so latency numbers measure the action, not the voice. A typed chat reply
      // is read on screen, so it's only spoken in spoken-feedback mode; so is a spoken command's reply
      // that only confirms what worked (a chime says it's done). Answers, questions and problems are read.
      const spokenMode = this.getSettings().feedback === "spoken";
      if (reply && (options.source !== "typed" || spokenMode)) {
        // Not awaited: the next command doesn't wait for Navi to finish talking.
        if (confirmation && !spokenMode) this.speaker.sound("done");
        else void this.say(reply).catch(() => undefined);
      }
      this.busy = false;
      this.current = null;
      this.threads.running = undefined;
      setWorkWindow(undefined);
      this.ui.setWorking(false);
      this.hooks.onActivity();
      const next = this.queue.shift();
      if (next) {
        // Said while Navi was working: the user has moved on, so the last reply is cut short.
        if (next.options.source !== "helper") {
          this.speechGen++;
          this.speaker.stop();
        }
        void this.run(next.text, next.options);
      }
    }
  }

  /**
   * What was said: the recognizer's best guess, unless that isn't a command and one of its other guesses
   * is ("scroll dune" / "scroll down"). Never a guess that closes or clears something.
   */
  private bestGuess(heard: string, alternatives: string[] = []): string {
    if (!alternatives.length || parseCommand(heard) || matchCommand(heard, this.commands)) return heard;
    const better = alternatives.find((a) => {
      const intent = parseCommand(a);
      return (intent && !isDestructive(intent) && !/^close/.test(intent.type)) || matchCommand(a, this.commands);
    });
    return better ?? heard;
  }

  /** The last few commands in the thread of the command running now. */
  private get recent(): string[] {
    return this.recentByThread.get(this.threads.running ?? this.threads.current) ?? [];
  }

  private remember(command: string, options: RunOptions, metric: Omit<CommandMetric, "t" | "command">) {
    const how = options.source === "typed" ? "typed" : options.source === "helper" ? "helpers reported" : "said";
    const result =
      metric.path === "error"
        ? `failed: ${metric.error}`
        : metric.path === "cancelled"
          ? "cancelled"
          : metric.path === "ignored"
            ? "ignored (not understood)"
            : this.turnMessage || "done";
    const thread = this.threads.running ?? this.threads.current;
    this.recentByThread.set(thread, [...this.recent, `${how} "${command}" → ${result.slice(0, 160)}`].slice(-6));
    const outcome = { fast: "ran", ai: "AI task", ignored: "ignored", error: "failed", cancelled: "cancelled", background: "background" }[metric.path];
    if (options.source !== "helper") {
      this.recentForRouter = [...this.recentForRouter, { said: command, outcome, reply: this.turnMessage || undefined }].slice(-3);
    }
  }

  /** Personal commands first, then built-in commands, then the AI. */
  private async dispatch(command: string, signal: AbortSignal, depth: number, options: RunOptions): Promise<Outcome> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    // The answer to "… has typing that isn't sent or saved. Close anyway?"; anything else moves on.
    const pending = this.pendingClose;
    this.pendingClose = null;
    if (pending && Date.now() < pending.until) {
      const answer = command.toLowerCase().replace(/[^a-z' ]/g, "").trim();
      if (/^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|close (?:it|them))\b/.test(answer)) {
        await this.execute(pending.intent, true);
        return { intent: pending.intent.type };
      }
      if (/^(?:no|nope|don't|dont|cancel|never ?mind|leave it|keep it)\b/.test(answer)) {
        await this.confirm("Left it open");
        return { intent: "confirm" };
      }
    }

    if (this.gridOn) {
      const gridCommand = parseGridCommand(command);
      if (gridCommand) {
        const detail = await this.grid(gridCommand);
        // Zooming just updates the log; clicking or closing the grid is confirmed like any action.
        if (this.gridOn) this.navi(detail);
        else await this.confirm(detail);
        return { intent: `grid:${gridCommand.type}` };
      }
    }

    // While number tags are showing, a bare number means "click that number".
    const bare = this.numbers ? parseBareNumber(command) : null;
    if (bare !== null) {
      await this.execute({ type: "clickNumber", n: bare });
      return { intent: "clickNumber" };
    }

    const custom = matchCommand(command, this.commands);
    if (custom) return this.runCustom(custom, signal, depth);

    if (isListCommandsRequest(command)) {
      const text = this.commands.length
        ? `You have ${this.commands.length} command${this.commands.length === 1 ? "" : "s"}: ${this.commands
            .map((c) => c.phrases[0])
            .join(", ")}.`
        : "You don't have any commands yet. Try saying: add a command open wordle.";
      this.navi(text);
      await this.say(text);
      return { intent: "listCommands" };
    }

    const intent = parseCommand(command);
    // A command the router reconstructed from loose (possibly misheard) speech never closes other tabs or
    // clears a field on its own: the user confirms by saying it plainly. (One closed tab is one "reopen
    // tab" away, so that just happens.)
    if (intent && options.fastOnly && isDestructive(intent) && this.getSettings().autonomy !== "yolo") {
      const text = `I heard “${command}” but didn't do it, to be safe. Say “${command}” if that's right.`;
      this.navi(text);
      await this.say(text);
      return { intent: "confirm" };
    }
    if (intent?.type === "describeScreen") return this.describeScreen(signal, options);
    if (intent) {
      try {
        await this.execute(intent);
        return { intent: intent.type };
      } catch (err) {
        if (!(err instanceof Unhandled)) throw err;
        const settings = this.getSettings();
        if (!keyFor(settings, settings.model) && err.message) throw new Error(err.message);
      }
    }

    if (options.fastOnly) throw new Unhandled();
    const settings = this.getSettings();
    const voice = options.source === "voice";
    if (!keyFor(settings, settings.model)) {
      this.ui.log(
        "step",
        options.source === "typed"
          ? `That isn't a built-in command. Type “what can I say” for examples, or add an OpenAI or Claude key in settings to chat.`
          : `Didn't catch that. Say “what can I say” for examples, or add an AI API key in settings.`,
      );
      this.speaker.sound("unknown");
      return { intent: "unknown" };
    }
    // Navi Free: the on-device model has to be there (a one-time download, and enough memory).
    if (settings.model === FREE_MODEL) {
      const status = await nanoStatusRemote();
      if (status !== "available") {
        this.ui.log("step", `Not a built-in command, and Navi Free's on-device AI isn't ready: ${NANO_STATUS_TEXT[status]}`);
        this.speaker.sound("unknown");
        return { intent: "unknown" };
      }
    }

    // Never send anything to an AI model from a site the user has blocked.
    const tab = await targetTab().catch(() => undefined);
    if (isBlocked(tab?.url, settings)) throw new Error("You've turned off Navi's AI on this site.");

    // Unrecognized speech: a fast small model decides if it's a command in other words, a real task, or
    // noise. Typed messages go straight to the main model: typing is for questions, chat and tasks.
    let routerMs: number | undefined;
    let routerCostUsd: number | undefined;
    if (voice && settings.routerModel !== "off" && keyFor(settings, settings.routerModel) && !options.routed && !intent) {
      const t0 = performance.now();
      this.ui.setWorking(true, "Understanding…");
      const routed = await routeUtterance(
        command,
        { title: tab?.title, personalPhrases: this.commands.flatMap((c) => c.phrases), recent: this.recentForRouter },
        settings,
        signal,
      ).catch((err: unknown) => {
        if (signal.aborted) throw err;
        return null;
      });
      const decision = routed?.decision ?? { route: "agent" as const };
      routerCostUsd = routed?.costUsd;
      routerMs = Math.round(performance.now() - t0);
      if (decision.route === "command") {
        this.ui.log("step", `Understood as “${decision.command}” · ${routerMs} ms`);
        const fastPath = await this.dispatch(decision.command, signal, depth + 1, {
          ...options,
          routed: true,
          fastOnly: true,
        }).catch((err: unknown) => {
          if (err instanceof Unhandled) return null;
          throw err;
        });
        if (fastPath) return { ...fastPath, routerMs, routerCostUsd };
      } else if (decision.route === "ignore") {
        this.ui.log("step", `Ignored “${command}” · ${routerMs} ms`);
        this.speaker.sound("unknown");
        return { intent: "ignored", routerMs, routerCostUsd };
      }
    }
    this.speaker.sound("thinking");
    const typed = options.source === "typed";
    const agent = settings.model === FREE_MODEL ? await this.runFree(command, signal, typed) : await this.runAgent(command, signal, typed);
    return { intent: typed ? "chat" : "ai", agent, routerMs, routerCostUsd };
  }

  private async runCustom(match: CommandMatch, signal: AbortSignal, depth: number): Promise<Outcome> {
    const { command, params } = match;
    if (depth >= MAX_DEPTH) throw new Error(`“${command.phrases[0]}” runs other commands too many levels deep.`);
    this.ui.log("step", `Your command: ${command.phrases[0]}`);
    let agent: AgentResult | undefined;
    let lastTab: chrome.tabs.Tab | undefined;
    for (const step of command.steps.map((s) => fillStep(s, params))) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (step.type === "open") {
        lastTab = await navigate(step.url, step.newTab);
      } else {
        const outcome = await this.dispatch(step.command, signal, depth + 1, { source: "step", routed: true });
        agent = outcome.agent ?? agent;
        lastTab = undefined;
      }
    }
    if (depth === 0 && !agent) {
      if (lastTab) await this.announcePage(lastTab, "Opened");
      else await this.confirm(`Done: ${command.phrases[0]}`);
    }
    return { intent: "custom", agent };
  }

  private async runAgent(command: string, signal: AbortSignal, typed = false, helperReport = false): Promise<AgentResult> {
    const result = await this.agent.run(
      command,
      {
        signal,
        onStep: (step) => {
          this.ui.setWorking(true, step);
          this.ui.log("step", step);
          this.hooks.onActivity();
        },
        // Part of the answer, told right away while the model keeps working.
        onSay: (text) => {
          this.navi(text);
          if (!typed || this.getSettings().feedback === "spoken") void this.say(text);
        },
      },
      { typed, helperReport, recent: this.recent, earlier: this.earlier(), helpers: this.helperApi(this.threads.running ?? this.threads.current) },
    );
    const seconds = (result.totalMs / 1000).toFixed(1);
    const meta = `AI · ${result.steps} step${result.steps === 1 ? "" : "s"} · ${seconds}s · ${formatCost(result.costUsd)}`;
    // Nothing to tell the user yet (the AI waits for the rest of its helpers).
    if (!result.reply) this.ui.log("step", `Noted the helpers' report · ${meta}`);
    else this.navi(result.reply, meta);
    return result;
  }

  /**
   * Navi Free: the on-device model answers, runs built-in commands in a row, and saves or deletes
   * voice commands. No browser use (clicking and typing on pages is Navi Pro).
   */
  private async runFree(command: string, signal: AbortSignal, typed: boolean): Promise<AgentResult> {
    const started = performance.now();
    const settings = this.getSettings();
    this.ui.setWorking(true, "Thinking on this computer…");
    this.ui.log("step", "Thinking on this computer…");
    const tab = await targetTab();
    const web = isWebUrl(tab.url);
    const pageText =
      web && settings.allowPageText
        ? (await pageRequest(tab, { kind: "readPage", maxChars: 3000 }).catch(() => undefined))?.text
        : undefined;
    // Questions about what's on screen get a picture of it (the model can see images).
    const screenshot =
      web && settings.allowScreenshots && tab.active && SCREEN_WORDS.test(command)
        ? await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 }).catch(() => undefined)
        : undefined;
    const t0 = performance.now();
    const answer = await freeChat({
      message: command,
      typed,
      page: { title: tab.title ?? "", url: tab.url ?? "" },
      pageText,
      screenshot,
      commands: this.commands.map(describeCommand),
      recent: this.recent,
      memory: settings.memory ? memoryBlock(await loadMemory()) : undefined,
      earlier: this.earlier(3),
    });
    const modelMs = performance.now() - t0;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    let steps = 1;
    if (answer.delete) {
      steps++;
      const removed = await deleteCommand(answer.delete);
      this.ui.log("step", removed ? `Deleted command “${removed.phrases[0]}”` : `No voice command matches “${answer.delete}”`);
    }
    if (answer.save.phrases.length && answer.save.steps.length) {
      steps++;
      const { command: saved, replaced } = await saveCommand({
        phrases: answer.save.phrases,
        steps: answer.save.steps.map((s) =>
          s.type === "open" ? { type: "open" as const, url: s.value, newTab: s.new_tab } : { type: "run" as const, command: s.value },
        ),
        description: answer.save.description,
      });
      this.ui.log("step", `${replaced ? "Updated" : "Saved"} command ${describeCommand(saved)}`);
    }
    for (const step of answer.run) {
      steps++;
      this.ui.setWorking(true, `Running “${step}”`);
      await this.dispatch(step, signal, 1, { source: "step", routed: true, fastOnly: true }).catch((err: unknown) => {
        if (!(err instanceof Unhandled)) throw err;
        this.ui.log("step", `“${step}” isn't a built-in command`);
      });
    }
    const reply = answer.reply || "Done.";
    const totalMs = performance.now() - started;
    this.navi(reply, `Free · on-device · ${(totalMs / 1000).toFixed(1)}s`);
    return { reply, steps, modelMs: Math.round(modelMs), totalMs: Math.round(totalMs), model: FREE_MODEL, usage: NO_USAGE, costUsd: 0 };
  }

  /** Always spoken: answers and errors. Queued behind anything Navi is still saying for this command. */
  private say(text: string): Promise<void> {
    const gen = this.speechGen;
    this.speech = this.speech.catch(() => undefined).then(() => (gen === this.speechGen ? this.speaker.say(text) : undefined));
    return this.speech;
  }

  /** Helpers the AI starts from a thread report back to it. */
  private helperApi(thread: string): HelperApi {
    return {
      start: async (req) => {
        const helper = await this.helpers.start(req, thread);
        const where = helper.window !== undefined ? "in its own window" : "without a browser";
        return `Helper ${helper.id} started ${where}. Its report comes to you when it's done.`;
      },
      check: () => this.helpers.check(thread),
      stop: (id) => (this.helpers.stop(id, "Navi stopped it") ? `Stopped helper ${id}.` : `Helper ${id} isn't running.`),
    };
  }

  /**
   * Helpers started in `thread` ended: the AI gets their report and decides what to tell the user. If it
   * already heard (it checked on them), there's nothing to do. Without the AI, Navi reads the report.
   */
  private async helperReport(thread: string, signal: AbortSignal): Promise<Outcome> {
    const report = this.helpers.report(thread);
    if (!report) return { intent: "helperReport" };
    const settings = this.getSettings();
    const tab = await targetTab().catch(() => undefined);
    if (settings.model === FREE_MODEL || !keyFor(settings, settings.model) || isBlocked(tab?.url, settings)) {
      this.navi(report);
      await this.say(report);
      return { intent: "helperReport" };
    }
    return { intent: "helperReport", agent: await this.runAgent(report, signal, false, true) };
  }

  /** Shows and says something at the next quiet moment, after anything Navi is already saying. */
  announce(text: string) {
    this.ui.log("navi", text);
    void this.say(text).catch(() => undefined);
  }

  // ---------- Tutorial ----------

  /** Starts the spoken tour, or acts on the panel's buttons and the tutorial's spoken words. */
  async tutorialAction(action: TutorialControl | "start") {
    if (action === "start") {
      await this.startTutorial();
      return;
    }
    if (!this.tutorial.active) return;
    // The user has moved on: the rest of what Navi was saying is dropped.
    this.speechGen++;
    this.speaker.stop();
    switch (action) {
      case "end":
        this.tutorialEnded("Okay, the tutorial is over. Say “start the tutorial” any time to take it again.", false);
        return;
      case "repeat":
        this.tutorialSay();
        return;
      case "next":
        this.tutorialNext("");
        return;
      case "yes":
      case "no": {
        if (this.tutorial.step?.done) return;
        const screenFree = action === "yes";
        await saveSettings({ feedback: screenFree ? "spoken" : "minimal" });
        this.tutorial.answer(screenFree);
        this.tutorialNext(
          screenFree
            ? "Okay, I'll say out loud what I do."
            : "Okay. I'll play a short sound when something works, and talk when there's something to tell you.",
        );
      }
    }
  }

  private async startTutorial() {
    const settings = this.getSettings();
    const ai =
      settings.model === FREE_MODEL
        ? (await nanoStatusRemote().catch(() => "unavailable")) === "available"
        : !!keyFor(settings, settings.model);
    this.tutorial.start({ name: settings.wakeName || "Navi", openMic: settings.listenMode === "open", ai, screenFree: settings.feedback === "spoken" });
    // The answer to its first question shouldn't need the wake name.
    this.hooks.onWake?.();
    this.tutorialSay();
  }

  /** A command ran: if it's what the current step asked for, on to the next one. */
  private tutorialSaw(event: TutorialEvent) {
    const step = this.tutorial.step;
    if (step?.done?.(event)) this.tutorialNext(step.praise ?? "");
  }

  private tutorialNext(prefix: string) {
    if (this.tutorial.advance()) this.tutorialSay(prefix);
    else this.tutorialEnded(prefix || "That's the tour.", true);
  }

  /** Says the current step (after `prefix`, e.g. praise for the last one) and shows it in the panel. */
  private tutorialSay(prefix = "") {
    const step = this.tutorial.step;
    const view = this.tutorial.view();
    if (!step || !view) return;
    this.ui.tutorial?.(view);
    const text = [prefix, step.say].filter(Boolean).join(" ");
    this.navi(text, `Tutorial · ${view.step} of ${view.total}`);
    const spoken = this.say(text).catch(() => undefined);
    // To practice waking Navi, it falls asleep once it has said how.
    if (step.sleepAfter) void spoken.then(() => this.tutorial.step === step && this.hooks.onSleep());
  }

  private tutorialEnded(text: string, finished: boolean) {
    this.tutorial.end();
    this.ui.tutorial?.(undefined);
    this.navi(text);
    void this.say(text).catch(() => undefined);
    this.hooks.onTutorialEnd?.(finished);
  }

  // ---------- Describe the screen ----------

  /**
   * What's on the screen, for someone who can't see it: the AI looks at it (Pro, or Free's on-device
   * model) and describes it. Without an AI, Navi says what it can tell from the page itself.
   */
  private async describeScreen(signal: AbortSignal, options: RunOptions): Promise<Outcome> {
    const settings = this.getSettings();
    const tab = await targetTab();
    let ai = !!keyFor(settings, settings.model) && isWebUrl(tab.url) && !isBlocked(tab.url, settings);
    if (ai && settings.model === FREE_MODEL) ai = (await nanoStatusRemote().catch(() => "unavailable")) === "available";
    if (ai) {
      this.speaker.sound("thinking");
      const typed = options.source === "typed";
      const agent =
        settings.model === FREE_MODEL ? await this.runFree(DESCRIBE_SCREEN, signal, typed) : await this.runAgent(DESCRIBE_SCREEN, signal, typed);
      return { intent: "describeScreen", agent };
    }
    const text = await this.pageSummary(tab);
    this.navi(text);
    await this.say(text);
    return { intent: "describeScreen" };
  }

  /** What Navi can tell about a page without an AI: its name and what can be used on screen. */
  private async pageSummary(tab: chrome.tabs.Tab): Promise<string> {
    const where = `You're on ${tab.title || "a page"}${isWebUrl(tab.url) ? `, at ${hostOf(tab.url)}` : ""}.`;
    const snap = isWebUrl(tab.url) ? await snapshot(tab).catch(() => null) : null;
    if (!snap) return `${where} I can't read this page.`;
    const visible = snap.elements.filter((e) => e.inViewport);
    const count = (roles: string[], one: string, many: string) => {
      const n = visible.filter((e) => roles.includes(e.role)).length;
      return n ? `${n} ${n === 1 ? one : many}` : "";
    };
    const parts = [
      count(["link"], "link", "links"),
      count(["button", "clickable"], "button", "buttons"),
      count(["textbox", "searchbox", "combobox"], "text field", "text fields"),
    ].filter(Boolean);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "nothing to click");
    return `${where} On screen there ${parts.length && !/^1 /.test(parts[0]) ? "are" : "is"} ${list}. Say “read this page” to hear its text. With an AI set up in settings, I can describe it fully.`;
  }

  /** What was said earlier in the thread of the command running now. */
  private earlier(max?: number): string {
    const thread = this.threads.get(this.threads.running ?? this.threads.current);
    return thread ? threadTranscript(thread, max) : "";
  }

  /**
   * A thread or window command said or typed directly: it runs right away, even while another command
   * runs. A new or switched-to thread shows its own feed, so nothing is logged for those; anything else
   * is a note in the current thread.
   */
  private async instantCommandNow(intent: InstantIntent, command: string, options: RunOptions) {
    const started = performance.now();
    const { text, speak, ok } = await this.instantCommand(intent);
    if ((intent.type !== "newThread" && intent.type !== "switchThread") || !ok) {
      this.lastMessage = text;
      this.ui.log("navi", text, undefined, { thread: this.threads.current, solo: true });
    }
    const row: CommandMetric = { t: new Date().toISOString(), command, path: "fast", intent: intent.type, ms: Math.round(performance.now() - started) };
    this.hooks.onMetric?.(row);
    void recordMetric(row).catch(() => undefined);
    if (options.source === "typed" && this.getSettings().feedback !== "spoken") return;
    if (speak || this.getSettings().feedback === "spoken") void this.say(text).catch(() => undefined);
    else this.speaker.sound("done");
  }

  /** Starts, switches, lists or renames threads, or pins Navi's window. `speak`: worth saying aloud (not just a chime). */
  private async instantCommand(intent: InstantIntent): Promise<{ text: string; speak: boolean; ok: boolean }> {
    const threads = this.threads;
    switch (intent.type) {
      case "stopHelpers": {
        if (intent.id !== undefined) {
          const stopped = this.helpers.stop(intent.id);
          return { text: stopped ? `Stopped helper ${intent.id}.` : `Helper ${intent.id} isn't running.`, speak: true, ok: stopped };
        }
        if (intent.everything) this.cancel();
        const stopped = this.helpers.stopAll();
        const what = stopped ? `Stopped ${stopped === 1 ? "the helper" : `${stopped} helpers`}` : "No helpers were running";
        return { text: intent.everything ? `${what}, and everything else.` : `${what}.`, speak: true, ok: true };
      }
      case "listHelpers": {
        const running = this.helpers.running();
        if (!running.length) return { text: "No helpers are running.", speak: true, ok: true };
        return { text: running.map((h) => describeHelper(h)).join(" "), speak: true, ok: true };
      }
      case "pinWindow": {
        if (!intent.on) {
          await this.pin.set(undefined);
          return { text: "Navi works in whichever window you're using again.", speak: true, ok: true };
        }
        await this.pin.set(await focusedWindowId());
        return { text: "Navi will work in this window, even while you use another one. Say “unpin Navi” to undo.", speak: true, ok: true };
      }
      case "newThread": {
        const thread = threads.create(intent.title);
        return { text: intent.title ? `New thread: ${threadTitle(thread)}.` : "New thread.", speak: false, ok: true };
      }
      case "switchThread": {
        const all = threads.list();
        const found = findThread(intent.name, all, threads.current);
        if (!found) {
          const names = all.map((t) => threadTitle(t)).join(", ");
          return { text: `I couldn't tell which thread you meant by “${intent.name}”. Your threads: ${names}.`, speak: true, ok: false };
        }
        if (found.id === threads.current) return { text: `You're already in “${threadTitle(found)}”.`, speak: true, ok: true };
        threads.switchTo(found.id);
        return { text: `Switched to “${threadTitle(found)}”.`, speak: true, ok: true };
      }
      case "listThreads": {
        const all = threads.list();
        const names = all.map((t) => `${threadTitle(t)}${t.id === threads.current ? " (this one)" : ""}`);
        return { text: `You have ${all.length} thread${all.length === 1 ? "" : "s"}: ${names.join(", ")}.`, speak: true, ok: true };
      }
      case "renameThread":
        threads.rename(threads.current, intent.title);
        return { text: `Renamed this thread to “${intent.title}”.`, speak: false, ok: true };
    }
  }

  /** The panel's pin button: Navi works only in this window, or (null) in whichever window the user is using. */
  async pinWindow(window: number | null) {
    await this.pin.ready;
    await this.pin.set(window ?? undefined);
  }

  /** The panel's thread menu. */
  threadAction(action: "new" | "switch" | "rename" | "delete", id?: string, title?: string) {
    if (action === "new") this.threads.create(title);
    else if (action === "switch" && id) this.threads.switchTo(id);
    else if (action === "rename" && id && title) this.threads.rename(id, title);
    else if (action === "delete" && id && this.threads.remove(id)) {
      this.agent.forgetThread(id);
      this.recentByThread.delete(id);
    }
  }

  /** Shows Navi's reply in the log and keeps it for "what did you say". */
  private navi(text: string, meta?: string) {
    this.lastMessage = text;
    this.turnMessage = text;
    this.ui.log("navi", text, meta);
  }

  private async autoScroll(action: "start" | "stop" | "faster" | "slower") {
    const res = await pageRequest(await targetTab(), { kind: "autoScroll", action });
    this.autoScrolling = !!res.active;
    return res.detail ?? "";
  }

  private async adjustVoice(change: "louder" | "quieter" | "faster" | "slower") {
    const s = this.getSettings();
    const round = (n: number) => Math.round(n * 100) / 100;
    const patch =
      change === "louder"
        ? { volume: round(Math.min(1, s.volume + 0.15)) }
        : change === "quieter"
          ? { volume: round(Math.max(0.1, s.volume - 0.15)) }
          : change === "faster"
            ? { speechRate: round(Math.min(2, s.speechRate + 0.15)) }
            : { speechRate: round(Math.max(0.6, s.speechRate - 0.15)) };
    await saveSettings(patch);
    return change;
  }

  /** Confirmation of an action: shown always, spoken only in spoken-feedback mode. */
  /** Searches with the page's own search box, if it has one. */
  private async searchOnPage(tab: chrome.tabs.Tab, query: string): Promise<boolean> {
    if (!isWebUrl(tab.url)) return false;
    const snap = await snapshot(tab).catch(() => null);
    const box = snap && pickSearchBox(snap.elements, tab.url);
    if (!snap || !box) return false;
    await pageRequest(tab, { kind: "type", id: box.id, gen: snap.gen, text: query, submit: true, clear: true });
    await waitForLoad(tab.id!, 5000);
    // "Search Marketplace" names where it searches; "Search the site" doesn't.
    const place = box.name.replace(/^search\s+(?:in\s+)?/i, "");
    await this.confirm(`Searching ${/^[A-Z]/.test(place) && !/^(?:The|This|Our|All)\b/.test(place) && place !== box.name ? place : "this site"} for ${query}`);
    return true;
  }

  private async confirm(text: string) {
    this.navi(text);
    // In the speech queue, so it never talks over what Navi is saying (e.g. the tutorial).
    if (this.getSettings().feedback === "spoken") void this.say(text).catch(() => undefined);
    else this.speaker.sound("done");
  }

  private async announcePage(tab: chrome.tabs.Tab, verb: string) {
    const title = tab.title || hostOf(tab.url);
    await this.confirm(`${verb} ${title}`.trim());
  }

  async setNumbers(show: boolean) {
    if (show && this.gridOn) await this.grid({ type: "hide" });
    const tab = await targetTab();
    await pageRequest(tab, { kind: show ? "showBadges" : "hideBadges" });
    this.numbers = show;
    this.ui.numbersShown(show);
  }

  get numbersShown() {
    return this.numbers;
  }

  /**
   * Default mode, before closing tabs: if any has typing that isn't sent or saved, asks instead (the next
   * "yes" closes them). True if it asked.
   */
  private async askBeforeLosingTyping(tabs: chrome.tabs.Tab[], intent: Intent, confirmed: boolean): Promise<boolean> {
    if (confirmed || this.getSettings().autonomy === "yolo") return false;
    const unsaved = await tabsWithUnsavedTyping(tabs);
    if (!unsaved.length) return false;
    const names = unsaved.map((t) => `“${t.title || hostOf(t.url)}”`).join(", ");
    const text = `${names} ${unsaved.length === 1 ? "has" : "have"} typing that isn't sent or saved. Close anyway?`;
    this.pendingClose = { intent, until: Date.now() + 60_000 };
    this.navi(text);
    await this.say(text);
    return true;
  }

  /** `confirmed`: the user already said yes to closing tabs with unsaved typing. */
  private async execute(intent: Intent, confirmed = false): Promise<void> {
    // Understood by the router ("let's start fresh on something else"): part of this command's card.
    if (isInstant(intent)) {
      const { text, speak } = await this.instantCommand(intent);
      if (speak) {
        this.navi(text);
        await this.say(text);
      } else await this.confirm(text);
      return;
    }
    const tab = await targetTab();
    switch (intent.type) {
      case "sleep":
        this.navi("Going to sleep.");
        this.hooks.onSleep();
        return;
      case "turnOff": {
        // Said before the mic goes off, so someone who can't see the screen knows how to turn it back on.
        const text = "Navi is off and isn't listening. Press Alt+Shift+M or click the mic to turn it back on.";
        this.navi(text);
        await this.say(text);
        this.hooks.onTurnOff();
        return;
      }
      case "help":
        this.navi(HELP_TEXT);
        await this.say(HELP_TEXT);
        return;
      case "tutorial":
        await this.startTutorial();
        return;
      case "openSettings":
        await chrome.runtime.openOptionsPage();
        await this.confirm("Opened Navi's settings");
        return;
      case "listenMode": {
        await saveSettings({ listenMode: intent.mode });
        const key = (await chrome.commands.getAll().catch(() => [])).find((c) => c.name === "wake-navi")?.shortcut;
        const text =
          intent.mode === "push"
            ? `Push to talk. The mic is closed until you press ${key || "the push-to-talk shortcut (set one in Chrome's shortcut settings)"}.`
            : intent.mode === "open"
              ? "Open mic: everything you say is a command until you turn the mic off."
              : `Wake word mode: say “Hey ${this.getSettings().wakeName}” before a command.`;
        this.navi(text);
        await this.say(text);
        return;
      }
      case "shortcuts":
        await chrome.tabs.create({ url: "chrome://extensions/shortcuts", windowId: await naviWindowId() });
        await this.confirm("Opened Chrome's shortcut settings: Navi's are at the top");
        return;
      case "panel": {
        const text = (await this.hooks.onPanel?.(intent.open, await naviWindowId())) ?? "";
        if (text) await this.confirm(text);
        return;
      }
      case "describeScreen":
        // Handled in dispatch (it may use the AI).
        return;
      case "scroll":
        await pageRequest(tab, { kind: "scroll", direction: intent.direction, amount: intent.amount });
        await this.confirm(
          intent.direction === "top" || intent.direction === "bottom"
            ? `Scrolled to the ${intent.direction}`
            : `Scrolling ${intent.direction}`,
        );
        return;
      case "back":
        await this.announcePage(await goBack(tab), "Back to");
        return;
      case "forward":
        await chrome.tabs.goForward(tab.id!).catch(() => {
          throw new Error("There's no next page.");
        });
        await this.announcePage(await waitForLoad(tab.id!), "Forward to");
        return;
      case "reload":
        await chrome.tabs.reload(tab.id!);
        await this.confirm("Reloading");
        return;
      case "newTab":
        // In Navi's window, not whichever window Chrome last focused.
        await chrome.tabs.create({ active: true, windowId: await naviWindowId() });
        await this.confirm("New tab");
        return;
      case "closeTab":
        if (await this.askBeforeLosingTyping([tab], intent, confirmed)) return;
        await chrome.tabs.remove(tab.id!);
        await this.confirm("Closed the tab");
        return;
      case "closeNamedTab": {
        // Close only a tab that clearly matches the name; never fall back to the current tab.
        const matches = await matchingTabs(intent.query);
        if (matches.length === 1 && matches[0].id !== undefined) {
          if (await this.askBeforeLosingTyping(matches, intent, confirmed)) return;
          await chrome.tabs.remove(matches[0].id);
          await this.confirm(`Closed ${matches[0].title || intent.query}`);
          return;
        }
        // "close the popup" and the like may be about the page, not a tab: let the AI look.
        if (!matches.length && !intent.saidTab) throw new Unhandled();
        const text = matches.length
          ? `Which one? ${matches.length} tabs match “${intent.query}”: ${matches
              .slice(0, 4)
              .map((t) => t.title || hostOf(t.url))
              .join("; ")}.`
          : `I couldn't find a tab called “${intent.query}”, so I didn't close anything.`;
        this.navi(text);
        await this.say(text);
        return;
      }
      case "nextTab":
      case "prevTab": {
        const next = await cycleTab(intent.type === "nextTab" ? 1 : -1);
        if (next) await this.announcePage(next, "");
        return;
      }
      case "reopenTab": {
        const restored = await chrome.sessions.restore();
        // Chrome restores into the window it last focused; the tab belongs in Navi's window.
        const win = await naviWindowId();
        const reopened = restored?.tab ?? restored?.window?.tabs?.[0];
        if (restored?.tab?.id !== undefined && win !== undefined && reopened?.windowId !== win) {
          await chrome.tabs.move(restored.tab.id, { windowId: win, index: -1 });
          await chrome.tabs.update(restored.tab.id, { active: true });
        }
        await this.confirm("Reopened the last closed tab");
        return;
      }
      case "moveTab": {
        await moveTab(tab, intent.to);
        await this.confirm(intent.to === "new" ? "Moved the tab to a new window" : "Moved the tab to your other window");
        return;
      }
      case "switchTab": {
        const tabs = await listTabs();
        const found =
          intent.index === -1
            ? tabs[tabs.length - 1]
            : intent.index !== undefined
              ? tabs[intent.index - 1]
              : intent.query
                ? await findTab(intent.query)
                : undefined;
        if (!found) {
          if (intent.index !== undefined) throw new Error(`There's no tab ${intent.index}.`);
          throw new Unhandled(`No open tab matches ${intent.query}.`);
        }
        await activateTab(found);
        await this.announcePage(found, "");
        return;
      }
      case "listTabs": {
        const tabs = await listTabs();
        const text = `You have ${tabs.length} tab${tabs.length === 1 ? "" : "s"}. ${tabs
          .map((t, i) => `${i + 1}: ${t.title || hostOf(t.url)}.`)
          .join(" ")}`;
        this.navi(text);
        await this.say(text);
        return;
      }
      case "open": {
        if (intent.newWindow) {
          const win = await chrome.windows.create({ url: intent.url, focused: true });
          const opened = win?.tabs?.[0]?.id !== undefined ? await waitForLoad(win.tabs[0].id) : undefined;
          await this.announcePage(opened ?? { title: intent.label } as chrome.tabs.Tab, "Opened in a new window:");
          return;
        }
        const opened = await navigate(intent.url, intent.newTab);
        await this.announcePage(opened, "Opened");
        return;
      }
      case "search": {
        // "Search for …" searches the site you're on: with its known search (YouTube, Amazon…), else its
        // own search box (Facebook Marketplace…). Only a page without one sends it to Google.
        const known = intent.onSite && siteEngine(tab.url);
        if (intent.onSite && !known && (await this.searchOnPage(tab, intent.query))) return;
        const engine = known || intent.engine;
        await navigate(engine === intent.engine ? intent.url : searchUrl(intent.query, engine), intent.newTab);
        await this.confirm(`Searching ${engine === "google" ? "" : `${engine} `}for ${intent.query}`);
        return;
      }
      case "siteSearch":
        if (!(await this.searchOnPage(tab, intent.query))) throw new Unhandled("I couldn't find a search box on this page.");
        return;
      case "clickNumber": {
        const res = await pageRequest(tab, { kind: "click", id: intent.n });
        await this.confirm(res.detail ?? `Clicked ${intent.n}`);
        return;
      }
      case "clickText": {
        const snap = await snapshot(tab);
        const match = bestMatch(intent.text, snap.elements);
        if (!match) throw new Unhandled(`I couldn't find ${intent.text}. Say flags, then a flag's number.`);
        const res = await pageRequest(tab, { kind: "click", id: match.element.id, gen: snap.gen });
        await this.confirm(res.detail ?? `Clicked ${match.element.name}`);
        return;
      }
      case "showGrid":
      case "hideGrid": {
        await this.confirm(await this.grid({ type: intent.type === "showGrid" ? "show" : "hide" }));
        return;
      }
      case "showNumbers":
      case "hideNumbers": {
        const show = intent.type === "showNumbers";
        await this.setNumbers(show);
        await this.confirm(show ? "Showing flags. Say a flag's number to click it." : "Flags hidden");
        return;
      }
      case "type": {
        try {
          const res = await pageRequest(tab, {
            kind: "type",
            id: intent.target,
            text: intent.text,
            submit: intent.submit,
            clear: false,
          });
          await this.confirm(res.detail === "typed" ? `Typed ${intent.text}` : `Typed ${intent.text} and submitted`);
        } catch (err) {
          // No field focused: let the AI find the right box.
          if (intent.target === undefined) throw new Unhandled(err instanceof Error ? err.message : String(err));
          throw err;
        }
        return;
      }
      case "pressKey": {
        const res = await pageRequest(tab, { kind: "pressKey", key: intent.key });
        await this.confirm(res.detail ?? `Pressed ${intent.key}`);
        return;
      }
      case "media": {
        // No <video> (a game's own volume, Spotify's player): the AI finds the page's controls instead.
        const res = await pageRequest(tab, { kind: "media", action: intent.action, seconds: intent.seconds, volume: intent.volume }).catch(
          (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            throw /no video/i.test(message) ? new Unhandled(message) : err;
          },
        );
        await this.confirm(res.detail ?? intent.action);
        return;
      }
      case "zoom":
        await zoom(intent.direction);
        await this.confirm(intent.direction === "reset" ? "Zoom reset" : `Zoomed ${intent.direction}`);
        return;
      case "muteTab":
        await chrome.tabs.update(tab.id!, { muted: intent.muted });
        await this.confirm(intent.muted ? "Tab muted" : "Tab unmuted");
        return;
      case "readPage": {
        // Read aloud locally; page text never leaves the browser for this.
        const res = await pageRequest(tab, { kind: "readPage", maxChars: 6000 });
        const text = res.text?.trim() || "There's no text to read on this page.";
        this.navi(text.length > 280 ? `${text.slice(0, 280)}…` : text, "Reading aloud · say stop to interrupt");
        await this.say(text);
        return;
      }
      case "whereAmI": {
        const snap = await snapshot(tab).catch(() => null);
        const count = snap ? snap.elements.filter((e) => e.inViewport).length : 0;
        const text = `You're on ${tab.title || "a page"}, at ${hostOf(tab.url) || "a browser page"}.${
          snap ? ` There are ${count} things you can click on screen.` : ""
        }`;
        this.navi(text);
        await this.say(text);
        return;
      }
      case "stop":
        return;
      case "repeat": {
        const text = this.lastMessage || "I haven't said anything yet.";
        this.ui.log("navi", text, "Repeated");
        await this.say(text);
        return;
      }
      case "ack":
        this.speaker.stop();
        if (intent.reply) {
          this.navi(intent.reply);
          await this.say(intent.reply);
        } else this.speaker.sound("done");
        return;
      case "voice": {
        const change = await this.adjustVoice(intent.change);
        // Let the next reply use the new settings, then demonstrate them.
        await sleep(50);
        const text = { louder: "Is this better?", quieter: "Is this better?", faster: "Okay, a bit faster.", slower: "Okay, a bit slower." }[change];
        this.navi(text);
        await this.say(text);
        return;
      }
      case "autoScroll":
        await this.confirm(await this.autoScroll(intent.action));
        return;
      case "fasterSlower":
        // "faster" means auto-scroll speed while scrolling, otherwise Navi's speaking speed.
        if (this.autoScrolling) await this.confirm(await this.autoScroll(intent.direction));
        else {
          await this.adjustVoice(intent.direction);
          const text = intent.direction === "faster" ? "Okay, a bit faster." : "Okay, a bit slower.";
          this.navi(text);
          await this.say(text);
        }
        return;
      case "siteHome": {
        const origin = new URL(tab.url ?? "").origin;
        if (!origin || origin === "null") throw new Error("This page has no home page.");
        await this.announcePage(await navigate(`${origin}/`, false), "Opened");
        return;
      }
      case "backN":
        for (let i = 0; i < intent.times; i++) await chrome.tabs.goBack(tab.id!).catch(() => undefined);
        await this.announcePage(await waitForLoad(tab.id!), "Back to");
        return;
      case "nextPage": {
        // Pagination link on search results and lists: "Next", "Next page", "›", "More results".
        const snap = await snapshot(tab);
        const next =
          bestMatch("next", snap.elements) ??
          bestMatch("next page", snap.elements) ??
          bestMatch("more results", snap.elements);
        if (!next) throw new Unhandled("I couldn't find a next page button here.");
        const res = await pageRequest(tab, { kind: "click", id: next.element.id, gen: snap.gen });
        await this.confirm(res.detail ?? "Next page");
        return;
      }
      case "newWindow":
        await chrome.windows.create({ focused: true });
        await this.confirm("New window");
        return;
      case "closeOtherTabs": {
        const otherTabs = (await listTabs()).filter((t) => t.id !== tab.id && !t.pinned);
        if (await this.askBeforeLosingTyping(otherTabs, intent, confirmed)) return;
        const others = otherTabs.map((t) => t.id!);
        if (others.length) await chrome.tabs.remove(others);
        await this.confirm(`Closed ${others.length} other tab${others.length === 1 ? "" : "s"}`);
        return;
      }
      case "duplicateTab":
        await chrome.tabs.duplicate(tab.id!);
        await this.confirm("Duplicated the tab");
        return;
      case "pinTab":
        await chrome.tabs.update(tab.id!, { pinned: intent.pinned });
        await this.confirm(intent.pinned ? "Pinned the tab" : "Unpinned the tab");
        return;
      case "switchBack": {
        const previous = (await listTabs())
          .filter((t) => t.id !== tab.id)
          .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
        if (!previous) throw new Error("There's no other tab.");
        await activateTab(previous);
        await this.announcePage(previous, "");
        return;
      }
      case "find": {
        try {
          const res = await pageRequest(tab, { kind: "find", text: intent.text });
          await this.confirm(res.detail ?? "Found it");
        } catch (err) {
          // Not literally on the page: maybe the AI can find what they meant.
          throw new Unhandled(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      case "edit": {
        const res = await pageRequest(tab, { kind: "edit", action: intent.action });
        await this.confirm(res.detail ?? "Done");
        return;
      }
      case "print":
        await pageRequest(tab, { kind: "print" });
        await this.confirm("Opening the print dialog");
        return;
      case "time":
      case "date": {
        const now = new Date();
        const text =
          intent.type === "time"
            ? `It's ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
            : `It's ${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.`;
        this.navi(text);
        await this.say(text);
        return;
      }
    }
  }
}
