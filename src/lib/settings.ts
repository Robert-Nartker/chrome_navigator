// User settings, stored locally in this browser profile (chrome.storage.local).

import { type ApiProvider, type Effort, PROVIDER_DEFAULTS, RETIRED_MODELS, modelInfo } from "./models";

/** "handsfree": say the wake name first. "open": every word is a command while the mic is on. */
export type ListenMode = "handsfree" | "open";
/**
 * How freely Navi acts. "default": asks only before what can't be taken back (sending, buying, deleting,
 * closing unsaved typing). "yolo": never asks except before payments and sensitive details, no step limit.
 */
export type Autonomy = "default" | "yolo";
/** Who turns speech into text, both on this computer: Chrome's built-in recognizer, or NVIDIA's Parakeet. */
export type Recognizer = "chrome" | "parakeet";
export type Feedback = "minimal" | "spoken";

/** "free": Chrome's on-device model, no browser tasks. "pro": the user's API key. */
export type AiMode = "free" | "pro";

/** The model Navi Free runs on (Chrome's built-in Gemini Nano). */
export const FREE_MODEL = "gemini-nano";

export interface Settings {
  /** Free or Pro; unset means Pro when there's a key, otherwise Free. */
  aiMode?: AiMode;
  /** Anthropic (Claude) API key. */
  apiKey: string;
  /** OpenAI API key, for GPT models. */
  openaiKey: string;
  model: string;
  /** Reasoning level for the main model; clamped to what the model supports. */
  effort: Effort;
  /** Opus fast mode: faster output at 2x price (research preview). */
  fastMode: boolean;
  wakeName: string;
  listenMode: ListenMode;
  recognizer: Recognizer;
  /** Seconds of silence before an active session goes back to sleep. */
  sessionTimeoutSec: number;
  /** "spoken" confirms every action out loud (for screen-free use). */
  feedback: Feedback;
  speechRate: number;
  /** Navi's voice and sound volume, 0-1. */
  volume: number;
  /** Small fast model that interprets commands the fast path doesn't recognize ("off" sends them straight to the main model). */
  routerModel: string;
  voiceName: string;
  lang: string;
  /** Whether the AI may read page text when asked to read/summarize/answer questions. */
  allowPageText: boolean;
  /** Whether the AI may take a screenshot when the element list isn't enough. */
  allowScreenshots: boolean;
  /** Send the current page's element list with typed messages (otherwise the AI looks when it needs to). */
  typedPageContext: boolean;
  /** Hostname fragments where Navi never sends anything to the AI. */
  blockedSites: string[];
  maxAgentSteps: number;
  autonomy: Autonomy;
  /** Who speaks Navi's replies: Navi's on-device voice (Kokoro), or the computer's system voices. */
  speechOutput: VoiceOutput;
  /** Navi's on-device voice: a Kokoro voice, e.g. "af_heart". */
  naviVoice: string;
}

export type VoiceOutput = "navi" | "chrome";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  openaiKey: "",
  // OpenAI's defaults; with only a Claude key, Navi uses Anthropic's (see activeSettings).
  model: PROVIDER_DEFAULTS.openai.model,
  effort: PROVIDER_DEFAULTS.openai.effort,
  fastMode: false,
  wakeName: "Navi",
  listenMode: "handsfree",
  recognizer: "chrome",
  sessionTimeoutSec: 120,
  feedback: "minimal",
  speechRate: 1.0,
  volume: 0.6,
  routerModel: PROVIDER_DEFAULTS.openai.routerModel,
  voiceName: "",
  lang: "en-US",
  allowPageText: true,
  allowScreenshots: true,
  typedPageContext: false,
  blockedSites: [],
  maxAgentSteps: 20,
  autonomy: "default",
  speechOutput: "navi",
  naviVoice: "af_heart",
};

/** The API key for a model's provider ("" if not set). The on-device model needs none. */
export function keyFor(s: Settings, model: string): string {
  const { provider } = modelInfo(model);
  if (provider === "chrome") return "on-device";
  return provider === "openai" ? s.openaiKey : s.apiKey;
}

/** Which providers have a key, OpenAI first. */
export function providersWithKeys(s: Settings): ApiProvider[] {
  return (["openai", "anthropic"] as ApiProvider[]).filter((p) => (p === "openai" ? s.openaiKey : s.apiKey));
}

/** Free or Pro, as Navi runs: Pro needs a key. */
export function aiModeOf(s: Settings): AiMode {
  if (!providersWithKeys(s).length) return "free";
  return s.aiMode ?? "pro";
}

/**
 * The settings Navi runs with. Free: the on-device model for everything. Pro: a model whose provider
 * has no key is swapped for the defaults of a provider that has one, so an OpenAI-only or
 * Anthropic-only setup just works.
 */
export function activeSettings(s: Settings): Settings {
  if (aiModeOf(s) === "free") return { ...s, model: FREE_MODEL, routerModel: FREE_MODEL, effort: "none" };
  const fallback = providersWithKeys(s)[0];
  if (!fallback) return s;
  const next = { ...s };
  if (!keyFor(s, s.model)) {
    next.model = PROVIDER_DEFAULTS[fallback].model;
    next.effort = PROVIDER_DEFAULTS[fallback].effort;
  }
  if (s.routerModel !== "off" && !keyFor(s, s.routerModel)) next.routerModel = PROVIDER_DEFAULTS[fallback].routerModel;
  return next;
}

/** Navi's on-device voice, unless system voices were chosen. */
export function naviVoiceOf(s: Settings): { voice: string } | undefined {
  return s.speechOutput === "chrome" ? undefined : { voice: s.naviVoice };
}

/** Defaults for anything missing, and renames from older versions. */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // "Click to talk" ("push") became "Open mic".
  if ((s.listenMode as string) === "push") s.listenMode = "open";
  if (s.recognizer !== "parakeet") s.recognizer = "chrome";
  if (s.autonomy !== "yolo") s.autonomy = "default";
  // The old default step limit (12) was too few for tasks that span several emails or pages.
  if (s.maxAgentSteps === 12) s.maxAgentSteps = 20;
  // Older models are replaced by their current-generation successors.
  s.model = RETIRED_MODELS[s.model] ?? s.model;
  s.routerModel = RETIRED_MODELS[s.routerModel] ?? s.routerModel;
  // ElevenLabs was removed (it keeps requests unless you're on an Enterprise plan): its voice setting
  // becomes Navi's own on-device voice.
  if (s.speechOutput !== "chrome") s.speechOutput = "navi";
  // Settings that no longer exist (including the old ElevenLabs key) aren't kept.
  for (const key of ["elevenLabsKey", "speechInput", "elevenVoiceId", "elevenModel", "filterBackgroundAudio", "naviVoiceEngine", "allowCloudSpeech"]) {
    delete (s as Record<string, unknown>)[key];
  }
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return normalizeSettings(stored.settings as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChanged(callback: (settings: Settings) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      callback(normalizeSettings(changes.settings.newValue as Partial<Settings>));
    }
  });
}

export function isBlocked(url: string | undefined, settings: Settings): boolean {
  if (!url) return false;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return settings.blockedSites.some((site) => site.trim() && host.includes(site.trim().toLowerCase()));
}
