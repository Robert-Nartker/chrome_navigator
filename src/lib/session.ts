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
  /** Navi was called by name (or "wake up") though it was already awake: worth a sound, if nothing else. */
  named?: boolean;
}

/** "Wake up" or "wake" (with a greeting or the name, or not), and maybe a command after it. */
const WAKE_UP = /^(?:(?:hey|hi|ok(?:ay)?|yo)[\s,.!]+)?(?:wakey wakey|wake up|wake)(?:[\s,.!]+(?:navi|navy|navigator))?(?:[\s,.!?]+(.*))?$/i;
/** The same, said on its own (while awake, "wake" can start an ordinary command). */
const JUST_WAKE_UP = /^(?:(?:hey|hi|ok(?:ay)?|yo)[\s,.!]+)?(?:wakey wakey|wake up|wake)(?:[\s,.!]+(?:navi|navy|navigator))?[\s,.!?]*$/i;
/** After the name is heard mid-phrase, the finished phrase is treated as the one that woke Navi. */
const SPOKEN_WAKE_MS = 8000;

export class WakeSession {
  private state: SessionState = "sleeping";
  private lastActivity = 0;
  /** When the name was heard in words still being spoken (Navi woke before the phrase was finished). */
  private wokeMidPhraseAt = -Infinity;
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
    return this.options.mode === "open" ? "awake" : this.state;
  }

  /** Milliseconds until the session falls asleep (0 when asleep). */
  get remainingMs(): number {
    if (this.current !== "awake" || this.options.mode === "open") return 0;
    return Math.max(0, this.lastActivity + this.options.timeoutSec * 1000 - this.now());
  }

  /** True if interim (partial) speech starts with the wake name or "wake up". */
  hearsWakePhrase(interim: string): boolean {
    return WAKE_UP.test(interim.trim()) || stripWakePhrase(interim, this.aliases, true).woke;
  }

  /**
   * The name was heard in words still being spoken: wake now, without waiting for the recognizer to
   * finish the phrase (it can hold or drop it). Returns whether Navi was asleep.
   */
  wakeMidPhrase(): boolean {
    if (this.current === "awake") return false;
    this.wake();
    this.wokeMidPhraseAt = this.now();
    return true;
  }

  /** A phrase without the wake name in front (for the recognizer's other guesses at a command). */
  withoutName(text: string): string {
    return stripWakePhrase(text, this.aliases, true).rest;
  }

  /** Decides what to do with a finished utterance. */
  handle(utterance: string): SessionDecision {
    this.expireIfIdle();
    const text = utterance.trim();
    // The phrase whose first words already woke Navi: it's handled as the waking one (no second sound).
    const wakingPhrase = this.now() - this.wokeMidPhraseAt < SPOKEN_WAKE_MS;
    this.wokeMidPhraseAt = -Infinity;
    const asleep = this.options.mode === "handsfree" && this.state === "sleeping";
    let woke: boolean;
    let rest: string;
    const wakeUp = (asleep || wakingPhrase ? WAKE_UP : JUST_WAKE_UP).exec(text);
    if (wakeUp) {
      woke = true;
      rest = (wakeUp[1] ?? "").trim();
    } else {
      // While asleep, stray words before the name are tolerated; once awake, only a leading name is removed.
      ({ woke, rest } = stripWakePhrase(text, this.aliases, asleep || wakingPhrase));
    }
    if (this.options.mode === "open") {
      return { command: rest || null, woke: false, named: woke };
    }
    if (this.state === "sleeping") {
      if (!woke) return { command: null, woke: false };
      this.wake();
      return { command: rest || null, woke: true };
    }
    this.touch();
    return { command: rest || null, woke: false, named: woke && !wakingPhrase };
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
