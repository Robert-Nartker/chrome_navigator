// Runs a command: fast path first (instant, no AI), then the Claude agent.

import { type AgentResult, NaviAgent } from "../lib/agent";
import {
  activateTab,
  cycleTab,
  findTab,
  hostOf,
  listTabs,
  navigate,
  pageRequest,
  snapshot,
  targetTab,
  waitForLoad,
  zoom,
} from "../lib/browser";
import {
  type CommandMatch,
  type CustomCommand,
  MAX_DEPTH,
  fillStep,
  isListCommandsRequest,
  loadCommands,
  matchCommand,
  onCommandsChanged,
} from "../lib/custom-commands";
import { bestMatch } from "../lib/match";
import { type CommandMetric, recordMetric } from "../lib/metrics";
import { type GridCommand, type Intent, isLikelyNoise, parseBareNumber, parseCommand, parseGridCommand } from "../lib/parser";
import { routeUtterance } from "../lib/router";
import { type Settings, isBlocked, saveSettings } from "../lib/settings";
import { Speaker, earcons } from "../lib/voice-output";

export type LogKind = "user" | "navi" | "step" | "info" | "error";

export interface ControllerUi {
  log(kind: LogKind, text: string, meta?: string): void;
  setWorking(working: boolean, detail?: string): void;
  numbersShown(shown: boolean): void;
  gridShown?(shown: boolean): void;
}

export const HELP_TEXT =
  "Try: scroll down, go back, open YouTube, search for pizza near me, new tab, close tab, show numbers, click 5, click sign in, type hello, read this page, or ask anything like: open my latest email. For anything hard to name, say show grid, then numbers to zoom in, then click. Make your own shortcuts by saying: add a command open wordle. Say go to sleep when you're done.";

/** The fast path couldn't do it; the AI gets a try. `message` is used if there's no AI. */
class Unhandled extends Error {}

export interface RunOptions {
  source: "voice" | "typed";
  /** Speech engine confidence (0-1), when it reports one. */
  confidence?: number;
  /** Skip the router (already interpreted, or a step of a personal command). */
  routed?: boolean;
  /** Only run built-in or personal commands; never fall through to the AI. */
  fastOnly?: boolean;
}

interface Outcome {
  intent?: string;
  routerMs?: number;
  /** Set when the AI handled (part of) the command. */
  agent?: AgentResult;
}

export class Controller {
  private readonly agent: NaviAgent;
  private current: AbortController | null = null;
  private queue: { text: string; options: RunOptions }[] = [];
  private busy = false;
  private numbers = false;
  private commands: CustomCommand[] = [];
  private gridOn = false;
  private autoScrolling = false;
  /** Last thing Navi said or showed, for "what did you say?". */
  private lastMessage = "";

  constructor(
    private readonly getSettings: () => Settings,
    private readonly ui: ControllerUi,
    readonly speaker: Speaker,
    private readonly hooks: { onSleep(): void; onActivity(): void; onMetric?(metric: CommandMetric): void },
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

  /** Stops whatever Navi is doing or saying. */
  cancel() {
    this.queue = [];
    if (this.autoScrolling) void this.autoScroll("stop").catch(() => undefined);
    this.current?.abort();
    this.speaker.stop();
    if (this.gridOn) void this.grid({ type: "hide" }).catch(() => undefined);
  }

  get gridShown() {
    return this.gridOn;
  }

  /** Mouse grid: show, zoom into a block, zoom out, click, or hide. */
  async grid(command: GridCommand): Promise<string> {
    const tab = await targetTab();
    const action = command.type === "show" ? "show" : command.type;
    const cell = "cell" in command ? command.cell : undefined;
    const res = await pageRequest(tab, { kind: "grid", action, cell });
    this.gridOn = !!res.gridActive;
    this.ui.gridShown?.(this.gridOn);
    return res.detail ?? "";
  }

  async run(text: string, options: RunOptions = { source: "typed" }): Promise<void> {
    const command = text.trim();
    if (!command) return;
    if (parseCommand(command)?.type === "stop") {
      this.ui.log("user", command);
      this.cancel();
      return;
    }
    if (this.busy) {
      // Commands spoken while Navi is working run in order afterwards.
      if (this.queue.length < 5) this.queue.push({ text: command, options });
      this.ui.log("info", `Next: “${command}”`);
      return;
    }
    this.ui.log("user", command);
    this.busy = true;
    this.ui.setWorking(true);
    const controller = new AbortController();
    this.current = controller;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let metric: Omit<CommandMetric, "t" | "command"> | null = null;
    let reply: string | null = null;
    try {
      const outcome = await this.dispatch(command, controller.signal, 0, options);
      if (outcome.agent) {
        const { agent } = outcome;
        metric = {
          path: "ai", intent: outcome.intent, ms: elapsed(), modelMs: agent.modelMs, steps: agent.steps,
          model: this.getSettings().model, routerMs: outcome.routerMs,
        };
        reply = agent.reply;
      } else if (outcome.intent === "ignored" || outcome.intent === "unknown") {
        metric = { path: "ignored", intent: outcome.intent, ms: elapsed(), routerMs: outcome.routerMs };
      } else {
        metric = { path: "fast", intent: outcome.intent, ms: elapsed(), routerMs: outcome.routerMs };
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
        earcons.error();
        if (this.getSettings().feedback === "spoken") reply = message;
      }
    } finally {
      if (metric) {
        const row: CommandMetric = { t: new Date().toISOString(), command, ...metric };
        this.hooks.onMetric?.(row);
        void recordMetric(row).catch(() => undefined);
      }
      // Speak after timing, so latency numbers measure the action, not the voice.
      if (reply) await this.say(reply).catch(() => undefined);
      this.busy = false;
      this.current = null;
      this.ui.setWorking(false);
      this.hooks.onActivity();
      const next = this.queue.shift();
      if (next) void this.run(next.text, next.options);
    }
  }

  /** Personal commands first, then built-in commands, then the AI. */
  private async dispatch(command: string, signal: AbortSignal, depth: number, options: RunOptions): Promise<Outcome> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    if (this.gridOn) {
      const gridCommand = parseGridCommand(command);
      if (gridCommand) {
        const detail = await this.grid(gridCommand);
        if (gridCommand.type === "click") await this.confirm(detail);
        else this.navi(detail);
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
    if (intent) {
      try {
        await this.execute(intent);
        return { intent: intent.type };
      } catch (err) {
        if (!(err instanceof Unhandled)) throw err;
        if (!this.getSettings().apiKey && err.message) throw new Error(err.message);
      }
    }

    if (options.fastOnly) throw new Unhandled();
    const settings = this.getSettings();
    const voice = options.source === "voice";
    // Keyboard clicks heard as "tiktok tiktok", lone filler words, very unsure transcripts: ignore quietly.
    if (voice && !intent && (isLikelyNoise(command) || (options.confidence && options.confidence < 0.35))) {
      this.ui.log("step", `Ignored “${command}” (sounded like noise)`);
      return { intent: "ignored" };
    }
    if (!settings.apiKey) {
      this.ui.log("step", `Didn't catch that. Say “what can I say” for examples, or add a Claude API key in settings.`);
      earcons.unknown();
      return { intent: "unknown" };
    }

    // Never send anything to an AI model from a site the user has blocked.
    const tab = await targetTab().catch(() => undefined);
    if (isBlocked(tab?.url, settings)) throw new Error("You've turned off Navi's AI on this site.");

    // Unrecognized: a fast small model decides if it's a command in other words, a real task, or noise.
    let routerMs: number | undefined;
    if (settings.routerModel !== "off" && !options.routed && !intent) {
      const t0 = performance.now();
      this.ui.setWorking(true, "Understanding…");
      const decision = await routeUtterance(
        command,
        { title: tab?.title, personalPhrases: this.commands.flatMap((c) => c.phrases) },
        settings,
        signal,
      ).catch((err: unknown) => {
        if (signal.aborted) throw err;
        return { route: "agent" as const };
      });
      routerMs = Math.round(performance.now() - t0);
      if (decision.route === "command") {
        this.ui.log("step", `Understood as “${decision.command}” · ${routerMs} ms`);
        const routed = await this.dispatch(decision.command, signal, depth + 1, {
          ...options,
          routed: true,
          fastOnly: true,
        }).catch((err: unknown) => {
          if (err instanceof Unhandled) return null;
          throw err;
        });
        if (routed) return { ...routed, routerMs };
      } else if (decision.route === "ignore" && voice) {
        this.ui.log("step", `Ignored “${command}” · ${routerMs} ms`);
        earcons.unknown();
        return { intent: "ignored", routerMs };
      }
    }
    earcons.thinking();
    return { intent: "ai", agent: await this.runAgent(command, signal), routerMs };
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
        const outcome = await this.dispatch(step.command, signal, depth + 1, { source: "typed", routed: true });
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

  private async runAgent(command: string, signal: AbortSignal): Promise<AgentResult> {
    const result = await this.agent.run(command, {
      signal,
      onStep: (step) => {
        this.ui.setWorking(true, step);
        this.ui.log("step", step);
        this.hooks.onActivity();
      },
    });
    const seconds = (result.totalMs / 1000).toFixed(1);
    this.navi(result.reply, `AI · ${result.steps} step${result.steps === 1 ? "" : "s"} · ${seconds}s`);
    return result;
  }

  /** Always spoken: answers and errors. */
  private async say(text: string) {
    await this.speaker.say(text);
  }

  /** Confirmation of an action: shown always, spoken only in spoken-feedback mode. */
  private navi(text: string, meta?: string) {
    this.lastMessage = text;
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

  private async confirm(text: string) {
    this.navi(text);
    if (this.getSettings().feedback === "spoken") void this.speaker.say(text);
    else earcons.done();
  }

  private async announcePage(tab: chrome.tabs.Tab, verb: string) {
    const title = tab.title || hostOf(tab.url);
    await this.confirm(`${verb} ${title}`.trim());
  }

  async setNumbers(show: boolean) {
    const tab = await targetTab();
    await pageRequest(tab, { kind: show ? "showBadges" : "hideBadges" });
    this.numbers = show;
    this.ui.numbersShown(show);
  }

  get numbersShown() {
    return this.numbers;
  }

  private async execute(intent: Intent): Promise<void> {
    const tab = await targetTab();
    switch (intent.type) {
      case "sleep":
        this.navi("Going to sleep.");
        this.hooks.onSleep();
        return;
      case "help":
        this.navi(HELP_TEXT);
        await this.say(HELP_TEXT);
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
        await chrome.tabs.goBack(tab.id!).catch(() => {
          throw new Error("There's no previous page.");
        });
        await this.announcePage(await waitForLoad(tab.id!), "Back to");
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
        await chrome.tabs.create({ active: true });
        await this.confirm("New tab");
        return;
      case "closeTab":
        await chrome.tabs.remove(tab.id!);
        await this.confirm("Closed the tab");
        return;
      case "nextTab":
      case "prevTab": {
        const next = await cycleTab(intent.type === "nextTab" ? 1 : -1);
        if (next) await this.announcePage(next, "");
        return;
      }
      case "reopenTab":
        await chrome.sessions.restore();
        await this.confirm("Reopened the last closed tab");
        return;
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
        const opened = await navigate(intent.url, intent.newTab);
        await this.announcePage(opened, "Opened");
        return;
      }
      case "search":
        await navigate(intent.url, intent.newTab);
        await this.confirm(`Searching ${intent.engine === "google" ? "" : `${intent.engine} `}for ${intent.query}`);
        return;
      case "siteSearch": {
        const snap = await snapshot(tab);
        const box =
          snap.elements.find((e) => e.role === "searchbox") ??
          snap.elements.find((e) => e.role === "textbox" && /search/i.test(e.name));
        if (!box) throw new Unhandled("I couldn't find a search box on this page.");
        await pageRequest(tab, { kind: "type", id: box.id, gen: snap.gen, text: intent.query, submit: true, clear: true });
        await this.confirm(`Searching this site for ${intent.query}`);
        return;
      }
      case "clickNumber": {
        const res = await pageRequest(tab, { kind: "click", id: intent.n });
        await this.confirm(res.detail ?? `Clicked ${intent.n}`);
        return;
      }
      case "clickText": {
        const snap = await snapshot(tab);
        const match = bestMatch(intent.text, snap.elements);
        if (!match) throw new Unhandled(`I couldn't find ${intent.text}. Say show numbers, then click a number.`);
        const res = await pageRequest(tab, { kind: "click", id: match.element.id, gen: snap.gen });
        await this.confirm(res.detail ?? `Clicked ${match.element.name}`);
        return;
      }
      case "showGrid":
      case "hideGrid": {
        const detail = await this.grid({ type: intent.type === "showGrid" ? "show" : "hide" });
        await this.confirm(intent.type === "showGrid" ? "Grid on. Say a number to zoom in, then say click." : detail);
        return;
      }
      case "showNumbers":
      case "hideNumbers": {
        const show = intent.type === "showNumbers";
        await this.setNumbers(show);
        await this.confirm(show ? "Showing numbers. Say click and a number." : "Numbers hidden");
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
        const res = await pageRequest(tab, { kind: "media", action: intent.action, seconds: intent.seconds });
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
        } else earcons.done();
        return;
      case "voice": {
        const change = await this.adjustVoice(intent.change);
        // Let the next reply use the new settings, then demonstrate them.
        await new Promise((r) => setTimeout(r, 50));
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
        const others = (await listTabs()).filter((t) => t.id !== tab.id && !t.pinned).map((t) => t.id!);
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
