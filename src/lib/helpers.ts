// Helpers: background agents that Navi's main AI starts for side tasks, like subagents in Claude Code.
// Each runs on the helper model (Settings; GPT-6.1 Sol at low reasoning by default) in a browser window
// of its own, opened without taking focus, or without a window for tasks that are only thinking and
// writing. The main AI checks on them and stops them when it wants; when one ends, its report goes back
// to the main AI, which decides what to tell the user.
//
// The supervisor stays light: one time limit (Settings, 15 minutes by default), a cap on how many run
// at once, and a nudge when a helper repeats the same action with nothing changing (stopped only if it
// keeps at it). The user can stop one or all of them any time, by voice or from the panel. Helpers never
// do anything irreversible (their instructions say so, and they have no tools to close tabs, talk, or
// change Navi); they prepare things and report back.

import { NaviAgent } from "./agent";
import type { Settings } from "./settings";

export const HELPER_RULES = {
  /** Helpers running at once (each has its own window). */
  running: 5,
  /** The same actions on an unchanged page this many times in a row: the helper is told it's going in circles. */
  nudgeAfter: 3,
  /** …and this many: it's stopped as stuck. */
  stopAfter: 8,
};

export type HelperStatus = "running" | "done" | "stopped" | "failed";

export interface HelperInfo {
  id: number;
  task: string;
  /** The thread it was started in; its report goes back there. */
  thread: string;
  window?: number;
  keepOpen: boolean;
  model: string;
  status: HelperStatus;
  step: number;
  costUsd: number;
  started: number;
  ended?: number;
  /** What it's doing now. */
  activity: string;
  /** The last thing it did on a page (not thinking). */
  lastAction?: string;
  result?: string;
  /** Why it stopped or failed. */
  why?: string;
  /** The main AI has seen how it ended. */
  collected: boolean;
}

/** What views show for a running helper. */
export type HelperSummary = Pick<HelperInfo, "id" | "task" | "step" | "costUsd" | "started" | "activity">;

/** Notices when the same actions keep leaving the page unchanged. */
export class StuckCheck {
  private last = "";
  private count = 0;

  /** How many times in a row these actions have left this same page. */
  note(actions: { name: string; input: Record<string, unknown> }[], page: string): number {
    const key = `${JSON.stringify(actions.map((a) => [a.name, a.input]))}@${page}`;
    this.count = key === this.last ? this.count + 1 : 1;
    this.last = key;
    return this.count;
  }
}

/** The settings a helper runs with: the helper model and reasoning, Navi's asking rules, no step limit. */
export function helperSettings(s: Settings): Settings {
  return {
    ...s,
    model: s.subagentModel,
    effort: s.subagentEffort,
    autonomy: "default",
    // The time limit is the limit.
    maxAgentSteps: Number.POSITIVE_INFINITY,
    fastMode: false,
    memory: false,
  };
}

/** "45 seconds", "3 minutes": reads well aloud. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.floor(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** One line about how a helper is doing or how it ended, for the main AI, the user and the log. */
export function describeHelper(h: HelperInfo, now = Date.now()): string {
  const name = `Helper ${h.id} (“${h.task.length > 80 ? `${h.task.slice(0, 80)}…` : h.task}”)`;
  switch (h.status) {
    case "running":
      return `${name}: working for ${formatDuration(now - h.started)}${h.step ? `, step ${h.step}` : ""}, now: ${h.activity}`;
    case "done":
      return `${name} finished: ${h.result}`;
    case "stopped":
      return `${name} was stopped: ${h.why}.${h.lastAction ? ` Its last action: ${h.lastAction}.` : ""}`;
    case "failed":
      return `${name} failed: ${h.why}.`;
  }
}

export interface HelperDeps {
  /** Navi's settings as it runs with them (activeSettings). */
  getSettings(): Settings;
  /** The running helpers changed. */
  onChange(running: HelperSummary[]): void;
  /** A helper ended (its report goes to the main AI, see report()). */
  onEnd(helper: HelperInfo): void;
}

export class Helpers {
  private all: HelperInfo[] = [];
  private seq = 0;
  private readonly stoppers = new Map<number, (why: string) => void>();

  constructor(private readonly deps: HelperDeps) {}

  running(): HelperInfo[] {
    return this.all.filter((h) => h.status === "running");
  }

  get(id: number): HelperInfo | undefined {
    return this.all.find((h) => h.id === id);
  }

  /** Starts a helper on `task` (in a new window at `url`, or without one if `url` is ""). */
  async start(req: { task: string; url: string; keepOpen: boolean }, thread: string): Promise<HelperInfo> {
    const task = req.task.trim();
    if (!task) throw new Error("A helper needs a task.");
    if (this.running().length >= HELPER_RULES.running) {
      throw new Error(`${HELPER_RULES.running} helpers are already running. Start this one after one of them reports back.`);
    }
    const settings = helperSettings(this.deps.getSettings());
    const helper: HelperInfo = {
      id: ++this.seq,
      task,
      thread,
      keepOpen: req.keepOpen,
      model: settings.model,
      status: "running",
      step: 0,
      costUsd: 0,
      started: Date.now(),
      activity: "Starting…",
      collected: false,
    };
    if (req.url) {
      // Its own window, opened behind the user's: it never takes focus.
      const win = await chrome.windows.create({ url: req.url, focused: false });
      helper.window = win?.id;
      const tab = win?.tabs?.[0];
      if (tab?.id !== undefined) await waitForComplete(tab.id);
    }
    this.all = [...this.all, helper].slice(-30);
    this.changed();
    void this.run(helper);
    return helper;
  }

  private async run(helper: HelperInfo) {
    const control = new AbortController();
    const stop = (why: string) => {
      if (control.signal.aborted) return;
      helper.why = why;
      control.abort();
    };
    this.stoppers.set(helper.id, stop);
    const minutes = this.deps.getSettings().helperMinutes;
    const timer = setTimeout(() => stop(`it reached its time limit (${minutes} minutes)`), minutes * 60_000);
    const stuck = new StuckCheck();
    const agent = new NaviAgent(() => helperSettings(this.deps.getSettings()), { role: "helper", window: helper.window });
    try {
      const result = await agent.run(helper.task, {
        signal: control.signal,
        onStep: (text) => {
          helper.activity = text;
          if (!/^(?:Thinking…|Step \d+…)$/.test(text)) helper.lastAction = text;
          this.changed();
        },
        onTurn: (costUsd, step) => {
          helper.costUsd = costUsd;
          helper.step = step;
          this.changed();
        },
        onActions: (actions, page) => {
          const repeats = stuck.note(actions, page);
          const what = [...new Set(actions.map((a) => a.name))].join(", ");
          if (repeats >= HELPER_RULES.stopAfter) stop(`it was stuck doing the same thing (${what}) with nothing changing`);
          else if (repeats >= HELPER_RULES.nudgeAfter) {
            return `Note from Navi: you've done this ${repeats} times in a row and the page hasn't changed. Try a different way, or stop and report what's in the way.`;
          }
          return undefined;
        },
      }, { timeLimitMinutes: minutes });
      helper.costUsd = result.costUsd;
      helper.result = result.reply;
      helper.status = "done";
    } catch (err) {
      if (control.signal.aborted) {
        helper.status = "stopped";
      } else {
        helper.status = "failed";
        helper.why = err instanceof Error ? err.message : String(err);
      }
    } finally {
      clearTimeout(timer);
      this.stoppers.delete(helper.id);
      helper.ended = Date.now();
      if (helper.window !== undefined && !(helper.status === "done" && helper.keepOpen)) {
        await chrome.windows.remove(helper.window).catch(() => undefined);
      }
      this.deps.onEnd(helper);
      this.changed();
    }
  }

  /** Stops one helper. */
  stop(id: number, why = "you stopped it"): boolean {
    const stop = this.stoppers.get(id);
    stop?.(why);
    return !!stop;
  }

  /** Stops every running helper; returns how many. */
  stopAll(why = "you stopped it"): number {
    const running = [...this.stoppers.values()];
    for (const stop of running) stop(why);
    return running.length;
  }

  /**
   * For the main AI's check_helpers: every running helper, and how the ones started in `thread` ended
   * if it hasn't heard yet.
   */
  check(thread: string): string {
    const ended = this.takeEnded(thread);
    const running = this.running();
    if (!ended.length && !running.length) return "No helpers are running.";
    return [...ended, ...running].map((h) => describeHelper(h)).join("\n");
  }

  /**
   * The report for the main AI when helpers started in `thread` have ended: how each one went (once),
   * and which are still running. "" if the main AI already knows.
   */
  report(thread: string): string {
    const ended = this.takeEnded(thread);
    if (!ended.length) return "";
    const lines = ended.map((h) => describeHelper(h));
    const others = this.running().filter((h) => h.thread === thread);
    if (others.length) lines.push(`Still running: ${others.map((h) => `Helper ${h.id}`).join(", ")}.`);
    return lines.join("\n");
  }

  private takeEnded(thread: string): HelperInfo[] {
    const ended = this.all.filter((h) => h.thread === thread && h.status !== "running" && !h.collected);
    for (const h of ended) h.collected = true;
    return ended;
  }

  summaries(): HelperSummary[] {
    return this.running().map(({ id, task, step, costUsd, started, activity }) => ({ id, task, step, costUsd, started, activity }));
  }

  private changed() {
    this.deps.onChange(this.summaries());
  }
}

/** Waits for a new window's first page to load (up to 15 s). */
async function waitForComplete(tabId: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab || tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}
