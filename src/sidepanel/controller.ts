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
import { type Intent, parseCommand } from "../lib/parser";
import type { Settings } from "../lib/settings";
import { Speaker, earcons } from "../lib/voice-output";

export type LogKind = "user" | "navi" | "step" | "info" | "error";

export interface ControllerUi {
  log(kind: LogKind, text: string, meta?: string): void;
  setWorking(working: boolean, detail?: string): void;
  numbersShown(shown: boolean): void;
}

export const HELP_TEXT =
  "Try: scroll down, go back, open YouTube, search for pizza near me, new tab, close tab, show numbers, click 5, click sign in, type hello, read this page, or ask anything like: open my latest email. Make your own shortcuts by saying: add a command open wordle. Say go to sleep when you're done.";

/** The fast path couldn't do it; the AI gets a try. `message` is used if there's no AI. */
class Unhandled extends Error {}

interface Outcome {
  intent?: string;
  /** Set when the AI handled (part of) the command. */
  agent?: AgentResult;
}

export class Controller {
  private readonly agent: NaviAgent;
  private current: AbortController | null = null;
  private queue: string[] = [];
  private busy = false;
  private numbers = false;
  private commands: CustomCommand[] = [];

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
    this.current?.abort();
    this.speaker.stop();
  }

  async run(text: string): Promise<void> {
    const command = text.trim();
    if (!command) return;
    if (parseCommand(command)?.type === "stop") {
      this.ui.log("user", command);
      this.cancel();
      return;
    }
    if (this.busy) {
      // Commands spoken while Navi is working run in order afterwards.
      if (this.queue.length < 5) this.queue.push(command);
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
      const outcome = await this.dispatch(command, controller.signal, 0);
      if (outcome.agent) {
        const { agent } = outcome;
        metric = { path: "ai", intent: outcome.intent, ms: elapsed(), modelMs: agent.modelMs, steps: agent.steps, model: this.getSettings().model };
        reply = agent.reply;
      } else {
        metric = { path: "fast", intent: outcome.intent, ms: elapsed() };
        this.ui.log("step", `Fast path · ${metric.ms} ms`);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        metric = { path: "cancelled", ms: elapsed() };
        this.ui.log("info", "Cancelled.");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        metric = { path: "error", ms: elapsed(), error: message };
        this.ui.log("error", message);
        earcons.error();
        reply = message;
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
      if (next) void this.run(next);
    }
  }

  /** Personal commands first, then built-in commands, then the AI. */
  private async dispatch(command: string, signal: AbortSignal, depth: number): Promise<Outcome> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const custom = matchCommand(command, this.commands);
    if (custom) return this.runCustom(custom, signal, depth);

    if (isListCommandsRequest(command)) {
      const text = this.commands.length
        ? `You have ${this.commands.length} command${this.commands.length === 1 ? "" : "s"}: ${this.commands
            .map((c) => c.phrases[0])
            .join(", ")}.`
        : "You don't have any commands yet. Try saying: add a command open wordle.";
      this.ui.log("navi", text);
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
    if (!this.getSettings().apiKey) {
      throw new Error(
        "I don't know that command yet. Say what can I say for examples, or add a Claude API key in settings for anything else.",
      );
    }
    earcons.thinking();
    return { intent: "ai", agent: await this.runAgent(command, signal) };
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
        const outcome = await this.dispatch(step.command, signal, depth + 1);
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
    this.ui.log("navi", result.reply, `AI · ${result.steps} step${result.steps === 1 ? "" : "s"} · ${seconds}s`);
    return result;
  }

  /** Always spoken: answers and errors. */
  private async say(text: string) {
    await this.speaker.say(text);
  }

  /** Confirmation of an action: shown always, spoken only in spoken-feedback mode. */
  private async confirm(text: string) {
    this.ui.log("navi", text);
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
        this.ui.log("navi", "Going to sleep.");
        this.hooks.onSleep();
        return;
      case "help":
        this.ui.log("navi", HELP_TEXT);
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
          intent.index !== undefined ? tabs[intent.index - 1] : intent.query ? await findTab(intent.query) : undefined;
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
        this.ui.log("navi", text);
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
        this.ui.log("navi", text.length > 280 ? `${text.slice(0, 280)}…` : text, "Reading aloud · say stop to interrupt");
        await this.say(text);
        return;
      }
      case "whereAmI": {
        const snap = await snapshot(tab).catch(() => null);
        const count = snap ? snap.elements.filter((e) => e.inViewport).length : 0;
        const text = `You're on ${tab.title || "a page"}, at ${hostOf(tab.url) || "a browser page"}.${
          snap ? ` There are ${count} things you can click on screen.` : ""
        }`;
        this.ui.log("navi", text);
        await this.say(text);
        return;
      }
      case "stop":
        return;
    }
  }
}
