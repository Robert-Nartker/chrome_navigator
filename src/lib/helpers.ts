// Helpers: background agents that Navi's main AI starts for side tasks. Each runs on the helper model
// (Settings: GPT-6.1 Sol at low reasoning by default) in a browser window of its own, opened without
// taking focus, or without a window for tasks that are only thinking and writing.
//
// A supervisor keeps them in check: a step limit, a time limit and a cost budget for each, at most
// three at once, and stuck detection (the same action again and again with nothing changing). The
// user can stop one or all of them any time. Helpers never do anything irreversible (their
// instructions say so, and they have no tools to close tabs, talk, or change Navi); they report back.

import { NaviAgent } from "./agent";
import type { Settings } from "./settings";

export const HELPER_LIMITS = {
  /** Model calls per helper. */
  steps: 15,
  minutes: 5,
  usd: 0.5,
  /** The same actions on an unchanged page this many times in a row: stuck. */
  repeats: 3,
  /** Helpers running at once. */
  running: 3,
};

export type HelperStatus = "running" | "done" | "stopped" | "failed";

export interface HelperInfo {
  id: number;
  task: string;
  /** The thread it was started in. */
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

  constructor(private readonly limit = HELPER_LIMITS.repeats) {}

  /** True once the same actions have left the same page `limit` times in a row. */
  note(actions: { name: string; input: Record<string, unknown> }[], page: string): boolean {
    const key = `${JSON.stringify(actions.map((a) => [a.name, a.input]))}@${page}`;
    this.count = key === this.last ? this.count + 1 : 1;
    this.last = key;
    return this.count >= this.limit;
  }
}

/** The settings a helper runs with: the helper model and reasoning, Navi's asking rules, the step limit. */
export function helperSettings(s: Settings): Settings {
  return {
    ...s,
    model: s.subagentModel,
    effort: s.subagentEffort,
    autonomy: "default",
    maxAgentSteps: HELPER_LIMITS.steps,
    fastMode: false,
    memory: false,
  };
}

/** One line about how a helper is doing or how it ended, for the main AI and the log. */
export function describeHelper(h: HelperInfo): string {
  const name = `Helper ${h.id} (“${h.task.length > 80 ? `${h.task.slice(0, 80)}…` : h.task}”)`;
  switch (h.status) {
    case "running":
      return `${name}: still working, step ${h.step}.`;
    case "done":
      return `${name} finished: ${h.result}`;
    case "stopped":
      return `${name} was stopped: ${h.why}.`;
    case "failed":
      return `${name} failed: ${h.why}.`;
  }
}

export interface HelperDeps {
  /** Navi's settings as it runs with them (activeSettings). */
  getSettings(): Settings;
  /** The running helpers changed. */
  onChange(running: HelperSummary[]): void;
  /** A helper ended. `awaited`: the main AI is waiting for it and will report it. */
  onEnd(helper: HelperInfo, awaited: boolean): void;
}

export class Helpers {
  private all: HelperInfo[] = [];
  private seq = 0;
  private readonly stoppers = new Map<number, (why: string) => void>();
  /** Threads whose main AI is waiting for its helpers (check_helpers with wait). */
  private readonly waiting = new Map<string, number>();
  private readonly ended = new Set<() => void>();

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
    if (this.running().length >= HELPER_LIMITS.running) {
      throw new Error(`${HELPER_LIMITS.running} helpers are already running; check_helpers with wait true, then try again.`);
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
    const timer = setTimeout(() => stop(`it ran out of time (${HELPER_LIMITS.minutes} minutes)`), HELPER_LIMITS.minutes * 60_000);
    const stuck = new StuckCheck();
    const agent = new NaviAgent(() => helperSettings(this.deps.getSettings()), { role: "helper", window: helper.window });
    try {
      const result = await agent.run(helper.task, {
        signal: control.signal,
        onStep: (text) => {
          helper.activity = text;
          this.changed();
        },
        onTurn: (costUsd, step) => {
          helper.costUsd = costUsd;
          helper.step = step;
          if (costUsd >= HELPER_LIMITS.usd) stop(`it reached its $${HELPER_LIMITS.usd.toFixed(2)} budget`);
          this.changed();
        },
        onActions: (actions, page) => {
          if (stuck.note(actions, page)) stop(`it was stuck doing the same thing (${[...new Set(actions.map((a) => a.name))].join(", ")}) with nothing changing`);
        },
      });
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
      this.deps.onEnd(helper, (this.waiting.get(helper.thread) ?? 0) > 0);
      for (const notify of this.ended) notify();
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
   * The helpers started in `thread` that the main AI hasn't heard the end of: how each is doing, or how
   * it ended. With `wait`, first waits (up to `maxMs`) for the running ones to end.
   */
  async collect(thread: string, wait: boolean, signal: AbortSignal, maxMs = 120_000): Promise<string> {
    const mine = () => this.all.filter((h) => h.thread === thread && !h.collected);
    if (wait && mine().some((h) => h.status === "running")) {
      this.waiting.set(thread, (this.waiting.get(thread) ?? 0) + 1);
      try {
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            if (!mine().some((h) => h.status === "running")) done();
          };
          const timer = setTimeout(() => done(), maxMs);
          const abort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
          };
          const cleanup = () => {
            clearTimeout(timer);
            this.ended.delete(check);
            signal.removeEventListener("abort", abort);
          };
          const done = () => {
            cleanup();
            resolve();
          };
          this.ended.add(check);
          signal.addEventListener("abort", abort);
          check();
        });
      } finally {
        this.waiting.set(thread, (this.waiting.get(thread) ?? 1) - 1);
      }
    }
    const list = mine();
    if (!list.length) return "No helpers to report on.";
    for (const h of list) if (h.status !== "running") h.collected = true;
    return list.map(describeHelper).join("\n");
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
