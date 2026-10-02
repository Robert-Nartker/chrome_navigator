// Messages between Navi's parts, all sent with chrome.runtime / chrome.tabs messaging:
// - ears: Navi's background page (offscreen document): microphone, speech recognition, wake word, voice
// - worker: the background service worker: runs commands (fast path, router, AI) and keeps the log
// - views: the side panel and the floating pill on web pages, which only show things and pass on clicks
// The side panel is optional: Navi works the same with it closed.

import type { CommandMetric } from "./metrics";
import type { NanoRequest } from "./nano";
import type { RecentCommand } from "./router";
import type { Settings } from "./settings";
import type { ThreadsState } from "./threads";
import type { EarconName } from "./voice-output";

export type LogKind = "user" | "navi" | "step" | "info" | "error";

export interface LogEntry {
  kind: LogKind;
  text: string;
  meta?: string;
  /** When it was logged (ms since the epoch). */
  t?: number;
  /** The command (turn) it belongs to; unset for notes outside a command. */
  turn?: string;
  /** The thread it belongs to (each thread has its own feed). */
  thread?: string;
}

export interface EarsState {
  /** The mic is on. */
  listening: boolean;
  /** Listening and awake (open mic, or after "Hey Navi"). */
  awake: boolean;
  /** Why listening doesn't work, if it doesn't. */
  micError: string;
  /** Which recognizer is listening, e.g. "Chrome (on-device)". */
  engineLabel: string;
  /** Which voice Navi last spoke with, e.g. "Kokoro (on-device)" ("" before it has spoken). */
  voiceLabel: string;
  /** Until the hands-free session falls asleep (0 when not counting down). */
  remainingMs: number;
  /** Navi is talking. */
  speaking: boolean;
  /** Hands-free and asleep: the last thing heard that didn't start with the wake name (cleared after a few seconds). */
  heardAsleep?: string;
  /** Speech goes into the chat box instead of running as commands. */
  dictating: boolean;
}

export const EARS_OFF: EarsState = {
  listening: false,
  awake: false,
  micError: "",
  engineLabel: "",
  voiceLabel: "",
  remainingMs: 0,
  speaking: false,
  dictating: false,
};

/** What the worker tells views about the command controller. */
export interface WorkerState {
  working: boolean;
  detail?: string;
  /** The command (turn) being worked on. */
  turn?: string;
  numbers: boolean;
  grid: boolean;
  /** The user wants Navi listening (mic on). */
  listening: boolean;
  /** Why Navi's background page (mic and voice) couldn't start, if it couldn't. */
  problem?: string;
  /** The window Navi is pinned to (it works only there), if it is. */
  pinnedWindow?: number;
}

/** Ears -> worker (views may listen in on state and interim). */
export type EarsEvent =
  | { type: "ears:ready" }
  | { type: "ears:command"; text: string; confidence: number }
  | { type: "ears:cancel" }
  | { type: "ears:state"; state: EarsState }
  | { type: "ears:interim"; text: string }
  | { type: "ears:log"; kind: "info" | "error"; text: string }
  /** Dictated words for the chat box: what's heard so far, then the finished phrase. */
  | { type: "ears:dictation"; text: string; final: boolean }
  | { type: "ears:heartbeat" };

/** Worker -> ears. `say` and `test` get a response. */
export type EarsRequest =
  | { type: "ears:configure"; settings: Settings }
  | { type: "ears:listen"; on: boolean }
  | { type: "ears:say"; text: string }
  | { type: "ears:stop-speaking" }
  | { type: "ears:sound"; name: EarconName }
  | { type: "ears:session"; action: "sleep" | "wake" | "touch" }
  | { type: "ears:dictate"; on: boolean }
  /** Navi Free's on-device model runs in the background page too. Answer: { text } or { error }. */
  | { type: "nano:prompt"; req: NanoRequest }
  | { type: "nano:status" }
  | { type: "ears:test"; action: EarsTestAction; text?: string; confidence?: number; muted?: boolean; phrases?: string[] };

export type EarsTestAction = "final" | "state" | "session" | "speakerBusy" | "lastSaid" | "mute" | "fakeParakeet";

/** Worker -> views. */
export type ViewEvent =
  | { type: "view:log"; entry: LogEntry }
  | { type: "view:worker"; state: WorkerState }
  | { type: "view:metric"; metric: CommandMetric }
  | { type: "view:threads"; state: ThreadsState };

/** Views -> worker; each gets a response. */
export type WorkerRequest =
  /** A typed message (or, for tests and the benchmark, a command as if spoken). */
  | { type: "navi:run"; text: string; source?: "typed" | "voice" }
  /** The user turning Navi on or off (remembered across Chrome restarts). */
  | { type: "navi:listen"; on: boolean }
  /** Listen for the name if Navi is on but not listening yet. */
  | { type: "navi:resume" }
  /** Dictate one phrase into the chat box. */
  | { type: "navi:dictate"; on: boolean }
  | { type: "navi:toggle"; what: "numbers" | "grid" }
  | { type: "navi:help" }
  | { type: "navi:hello" }
  /** The panel's pin button: Navi works only in this window (null: in whichever window the user is using). */
  | { type: "navi:pin"; window: number | null }
  /** The panel's thread menu: start, switch to, rename or delete a thread. */
  | { type: "navi:thread"; action: "new" | "switch" | "rename" | "delete"; id?: string; title?: string }
  | {
      type: "navi:test";
      action: "reset" | "route" | "busy" | "ears" | "wake" | "memory" | "focus";
      text?: string;
      recent?: RecentCommand[];
      ears?: Extract<EarsRequest, { type: "ears:test" }>;
      /** "focus": the window to treat as the one the user is using (headless Chrome doesn't move focus). */
      window?: number;
    };

/** What a view gets when it opens. */
export interface WorkerHello {
  worker: WorkerState;
  ears: EarsState;
  log: LogEntry[];
  metrics: CommandMetric[];
  threads: ThreadsState;
}

/** Worker -> the floating pill in the active tab. */
export interface PillUpdate {
  type: "pill:update";
  ears: EarsState;
  worker: WorkerState;
  interim?: string;
  /** Navi's latest reply or error, to show briefly. */
  reply?: { kind: "navi" | "error"; text: string };
  wakeName: string;
  mode: Settings["listenMode"];
}
