// Wake-word session logic. Say "Hey Navi" once to wake it; it then treats
// everything you say as a command until you've been quiet for the timeout, or
// you say "go to sleep". No need to repeat the name for every command.

import { type WakeWords, stripWakePhrase, wakeAliases } from "./parser";
import type { ListenMode } from "./settings";

export type SessionState = "sleeping" | "awake";

export interface SessionOptions {
  mode: ListenMode;
  wakeName: string;
  timeoutSec: number;
}

export interface SessionDecision {
  /** Command text to run, if any (wake phrase removed). */
  command: string | null;
  /** The utterance just woke the session. */
  woke: boolean;
}

export class WakeSession {
  private state: SessionState = "sleeping";
  private lastActivity = 0;
  private aliases: WakeWords;

  constructor(private options: SessionOptions, private readonly now: () => number = Date.now) {
    this.aliases = wakeAliases(options.wakeName);
  }

  configure(options: SessionOptions) {
    this.options = options;
    this.aliases = wakeAliases(options.wakeName);
  }

  get current(): SessionState {
    this.expireIfIdle();
    return this.options.mode === "push" ? "awake" : this.state;
  }

  /** Milliseconds until the session falls asleep (0 when asleep). */
  get remainingMs(): number {
    if (this.current !== "awake" || this.options.mode === "push") return 0;
    return Math.max(0, this.lastActivity + this.options.timeoutSec * 1000 - this.now());
  }

  /** True if interim (partial) speech starts with the wake name, for instant visual feedback. */
  hearsWakePhrase(interim: string): boolean {
    return stripWakePhrase(interim, this.aliases, true).woke;
  }

  /** Decides what to do with a finished utterance. */
  handle(utterance: string): SessionDecision {
    this.expireIfIdle();
    // While asleep, stray words before the name are tolerated; once awake, only a leading name is removed.
    const { woke, rest } = stripWakePhrase(utterance, this.aliases, this.options.mode === "handsfree" && this.state === "sleeping");
    if (this.options.mode === "push") {
      return { command: rest || null, woke: false };
    }
    if (this.state === "sleeping") {
      if (!woke) return { command: null, woke: false };
      this.wake();
      return { command: rest || null, woke: true };
    }
    this.touch();
    return { command: rest || null, woke: false };
  }

  wake() {
    this.state = "awake";
    this.touch();
  }

  sleep() {
    this.state = "sleeping";
  }

  /** Keeps the session awake (call after each command and while one is running). */
  touch() {
    this.lastActivity = this.now();
  }

  private expireIfIdle() {
    if (this.state === "awake" && this.now() - this.lastActivity > this.options.timeoutSec * 1000) {
      this.state = "sleeping";
    }
  }
}
