// The side panel's activity feed. The controller logs flat entries (user, step, navi, info, error); the feed
// groups them into one card per command, kept minimal:
// - quick commands (no AI): what you said and the result; routed ones add a small "heard as …" note
// - AI tasks: one collapsible row holding the steps (the live step also shows in the voice card)
// - ignored or not understood: a single faint line
// Every entry is still an `li.<kind>` inside #log, so tests and the log restore keep working.

import type { LogEntry, LogKind } from "../lib/messages";

type TurnState = "idle" | "working" | "done";

interface Turn {
  id: string;
  el: HTMLLIElement;
  items: HTMLUListElement;
  trace: {
    li: HTMLLIElement;
    label: HTMLElement;
    time: HTMLElement;
    list: HTMLOListElement;
  };
  state: TurnState;
  /** The AI worked on this command (it gets the steps row). */
  ai: boolean;
  /** What the router turned loose speech into, if it did. */
  heard: string;
  heardEl: HTMLLIElement;
  start?: number;
  end?: number;
  steps: number;
  /** What Navi is doing right now (latest step or status detail). */
  activity: string;
  result: "none" | "ok" | "error";
}

const MAX_ENTRIES = 200;
const SPEAKER: Partial<Record<LogKind, string>> = { user: "You: ", navi: "Navi: ", error: "Error: " };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** "40 ms", "4.2 s", "1 m 5 s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Only for the bullet style: model turns, page actions, or bookkeeping (routing, timing, ignored). */
function stepType(text: string): "think" | "action" | "meta" {
  if (/^(Thinking|Step \d+)/.test(text)) return "think";
  if (/^(Fast path|Routed|Understood as|Ignored|Your command|Didn't catch)\b/.test(text)) return "meta";
  return "action";
}

export class Feed {
  private readonly turns = new Map<string, Turn>();
  /** The newest command card. */
  private latest: Turn | null = null;
  /** The card of the command Navi is working on. */
  private active: Turn | null = null;
  private working = false;
  /** The command being worked on (its card may be in a thread that isn't showing). */
  private workingTurn: string | undefined;
  private ticker: number | undefined;
  private readonly sizes = new WeakMap<Element, number>();
  private total = 0;
  private seq = 0;
  /** Placement for legacy entries (saved before turns had ids). */
  private legacyTurn: string | undefined;

  constructor(
    private readonly list: HTMLOListElement,
    private readonly announcer: HTMLElement,
  ) {}

  /** Shows an entry that already knows its command (logged by the background worker). */
  push(entry: LogEntry) {
    const follow = entry.kind === "user" || this.nearBottom();
    this.render(entry);
    if (entry.kind === "navi" || entry.kind === "error") this.announce(entry.text);
    if (follow) this.list.scrollTop = this.list.scrollHeight;
  }

  /** Rebuilds the feed from saved entries (all finished, except a command still running). */
  restore(entries: LogEntry[]) {
    const activeId = this.workingTurn ?? this.active?.id;
    this.list.replaceChildren();
    this.turns.clear();
    this.total = 0;
    this.latest = this.active = null;
    this.legacyTurn = undefined;
    for (const entry of entries) this.render(entry);
    for (const turn of this.turns.values()) {
      if (turn.id === activeId && this.working) {
        this.active = turn;
        turn.state = "working";
      } else {
        turn.state = "done";
      }
      this.paint(turn);
    }
    this.list.scrollTop = this.list.scrollHeight;
  }

  /** Mirrors the controller's working state onto the command card. Safe to call repeatedly. */
  setWorking(on: boolean, detail?: string, turn?: string) {
    this.workingTurn = on ? turn : undefined;
    if (on && !this.working) {
      this.working = true;
      // The command being worked on: the one named, else the one just logged.
      const named = turn === undefined ? undefined : this.turns.get(turn);
      if (named) {
        this.active = named;
        this.active.state = "working";
      } else if (turn === undefined && this.latest?.state === "idle") {
        this.active = this.latest;
        this.active.state = "working";
      }
      window.clearInterval(this.ticker);
      this.ticker = window.setInterval(() => this.active && this.paint(this.active), 200);
    } else if (!on && this.working) {
      this.working = false;
      window.clearInterval(this.ticker);
      const finished = this.active;
      this.active = null;
      if (finished) {
        finished.state = "done";
        this.paint(finished);
      }
      if (this.latest?.state === "idle") this.latest.state = "done";
    }
    // Its card showed up after the work started (e.g. its thread was opened).
    if (on && !this.active && turn !== undefined && this.turns.get(turn)) {
      this.active = this.turns.get(turn)!;
      this.active.state = "working";
      this.paint(this.active);
    }
    if (on && detail && this.active) {
      this.active.activity = detail;
      this.paint(this.active);
    }
  }

  /** What Navi is doing right now, for the caption while it works. */
  get activity(): string {
    return this.active?.activity ?? "";
  }

  /** The newest reply's text (without its timing line). */
  lastReply(): string {
    const replies = this.list.querySelectorAll("li.navi > .text");
    return replies[replies.length - 1]?.textContent ?? "";
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
  }

  private nearBottom(): boolean {
    return this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 80;
  }

  private announce(text: string) {
    const p = el("p", undefined, text);
    this.announcer.append(p);
    while (this.announcer.childElementCount > 3) this.announcer.firstElementChild?.remove();
  }

  private render(entry: LogEntry) {
    let turnId = entry.turn;
    if (entry.t === undefined) {
      // Saved by an older version: group by order instead.
      if (entry.kind === "user") turnId = this.legacyTurn = this.newId();
      else if (entry.kind !== "info") turnId = this.legacyTurn;
    }
    if (!turnId) {
      // The same error again (e.g. a button pressed twice on a Chrome page): count it instead of repeating it.
      const prev = this.list.lastElementChild as HTMLElement | null;
      if (entry.kind === "error" && prev?.matches("li.solo.error") && prev.querySelector(".text")?.textContent === entry.text) {
        const count = Number(prev.dataset.count ?? "1") + 1;
        prev.dataset.count = String(count);
        let badge = prev.querySelector(".count");
        if (!badge) prev.append((badge = el("span", "count")));
        badge.textContent = `×${count}`;
        return;
      }
      const li = this.entryItem(entry);
      li.classList.add("solo");
      this.list.append(li);
      this.grow(li);
      return;
    }
    let turn = this.turns.get(turnId);
    if (!turn) turn = this.createTurn(turnId);
    const t = entry.t;
    switch (entry.kind) {
      case "user": {
        const li = this.entryItem(entry);
        turn.items.prepend(li);
        li.after(turn.heardEl);
        if (t !== undefined) turn.start = t;
        break;
      }
      case "step": {
        const li = this.entryItem(entry);
        li.dataset.type = stepType(entry.text);
        if (li.dataset.type === "think") turn.ai = true;
        const heard = /^Understood as “(.+?)”/.exec(entry.text);
        if (heard) turn.heard = heard[1];
        turn.trace.list.append(li);
        turn.steps++;
        turn.activity = entry.text;
        if (t !== undefined) turn.end = t;
        break;
      }
      case "navi":
      case "error":
        if (entry.meta?.startsWith("AI")) turn.ai = true;
        turn.items.append(this.entryItem(entry));
        // The latest result decides: a passing hiccup (e.g. the speech service) doesn't fail a command that then worked.
        turn.result = entry.kind === "error" ? "error" : "ok";
        if (t !== undefined) turn.end = t;
        break;
      default:
        turn.items.append(this.entryItem(entry));
    }
    if (turn.start === undefined && t !== undefined) turn.start = t;
    this.paint(turn);
    this.grow(turn.el);
  }

  private createTurn(id: string): Turn {
    // Any older card that never started working (e.g. "stop") is finished now.
    if (this.latest?.state === "idle") this.latest.state = "done";
    const li = el("li", "turn");
    const items = el("ul", "turn-items");
    const traceLi = el("li", "trace");
    const details = el("details");
    const summary = el("summary");
    summary.innerHTML =
      '<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="trace-icon" aria-hidden="true"></span>';
    const label = el("span", "trace-label");
    const time = el("span", "trace-time");
    summary.append(label, time);
    const list = el("ol", "step-list");
    details.append(summary, list);
    // Opening the row keeps the whole card, reply included, in view.
    details.addEventListener("toggle", () => {
      if (details.open) li.scrollIntoView({ block: "nearest" });
    });
    traceLi.append(details);
    traceLi.hidden = true;
    const heardEl = el("li", "heard");
    heardEl.hidden = true;
    items.append(heardEl, traceLi);
    li.append(items);
    this.list.append(li);
    const turn: Turn = {
      id,
      el: li,
      items,
      trace: { li: traceLi, label, time, list },
      state: "idle",
      ai: false,
      heard: "",
      heardEl,
      steps: 0,
      activity: "",
      result: "none",
    };
    this.turns.set(id, turn);
    this.latest = turn;
    return turn;
  }

  private entryItem(entry: LogEntry): HTMLLIElement {
    const li = el("li", entry.kind);
    const speaker = SPEAKER[entry.kind];
    if (speaker) li.append(el("span", "sr-only", speaker));
    li.append(el("span", "text", entry.text));
    if (entry.meta) li.append(el("span", "meta", entry.meta));
    return li;
  }

  /** Updates a card's step row: spinner and latest step while working, a summary once done. */
  private paint(turn: Turn) {
    const { trace } = turn;
    const working = turn.state === "working";
    turn.el.dataset.state = working ? "working" : "done";
    // Finished quick commands need no steps row; ignored ones keep it as their one-line outcome.
    const quiet = !working && !turn.ai && turn.result === "none";
    turn.el.dataset.kind = turn.ai ? "ai" : quiet ? "quiet" : "quick";
    trace.li.hidden = !working && (turn.steps === 0 || (!turn.ai && !quiet));
    turn.heardEl.hidden = working || turn.ai || quiet || !turn.heard;
    const heardText = turn.heard ? `heard as “${turn.heard}”` : "";
    if (turn.heardEl.textContent !== heardText) turn.heardEl.textContent = heardText;
    trace.li.dataset.state = working ? "working" : turn.result === "none" ? "plain" : turn.result;
    let label: string;
    let time: string;
    const took = turn.start !== undefined && turn.end !== undefined ? formatDuration(turn.end - turn.start) : "";
    if (working) {
      label = turn.activity || "Working…";
      time = turn.start !== undefined ? formatDuration(Date.now() - turn.start) : "";
    } else if (turn.result !== "none") {
      label = `${turn.steps} step${turn.steps === 1 ? "" : "s"}`;
      time = took;
    } else {
      // No reply (ignored, not understood): the last step is the outcome, so show it.
      label = turn.activity;
      time = [turn.steps > 1 ? `${turn.steps} steps` : "", took].filter(Boolean).join(" · ");
    }
    if (trace.label.textContent !== label) trace.label.textContent = label;
    if (trace.time.textContent !== time) trace.time.textContent = time;
  }

  /** Counts entries and drops the oldest cards past the cap. */
  private grow(node: Element) {
    this.sizes.set(node, (this.sizes.get(node) ?? 0) + 1);
    this.total++;
    while (this.total > MAX_ENTRIES && this.list.firstElementChild) {
      const first = this.list.firstElementChild;
      if (first === this.active?.el || first === this.latest?.el) break;
      this.total -= this.sizes.get(first) ?? 1;
      for (const [id, turn] of this.turns) if (turn.el === first) this.turns.delete(id);
      first.remove();
    }
  }
}
