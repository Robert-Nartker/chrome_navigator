// User settings, stored locally in this browser profile (chrome.storage.local).

import { DEFAULT_VOICE_ID } from "./elevenlabs";
import { type Effort, PROVIDER_DEFAULTS, type Provider, RETIRED_MODELS, modelInfo } from "./models";

/** "handsfree": say the wake name first. "open": every word is a command while the mic is on. */
export type ListenMode = "handsfree" | "open";
export type Feedback = "minimal" | "spoken";

export interface Settings {
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
  /** Fall back to Google's cloud speech service when on-device recognition isn't available. */
  allowCloudSpeech: boolean;
  /** Whether the AI may read page text when asked to read/summarize/answer questions. */
  allowPageText: boolean;
  /** Whether the AI may take a screenshot when the element list isn't enough. */
  allowScreenshots: boolean;
  /** Send the current page's element list with typed messages (otherwise the AI looks when it needs to). */
  typedPageContext: boolean;
  /** Hostname fragments where Navi never sends anything to the AI. */
  blockedSites: string[];
  maxAgentSteps: number;
  /** ElevenLabs key: higher-quality speech-to-text and Navi's voice. Optional. */
  elevenLabsKey: string;
  /** Who transcribes commands while Navi is awake. ElevenLabs is used only when a key is set. */
  speechInput: SpeechProvider;
  /** Who speaks Navi's replies. ElevenLabs is used only when a key is set. */
  speechOutput: SpeechProvider;
  elevenVoiceId: string;
  elevenModel: string;
  /** Ignore nearby conversations and background audio (ElevenLabs speech-to-text). */
  filterBackgroundAudio: boolean;
}

export type SpeechProvider = "elevenlabs" | "chrome";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  openaiKey: "",
  // OpenAI's defaults; with only a Claude key, Navi uses Anthropic's (see withAvailableModels).
  model: PROVIDER_DEFAULTS.openai.model,
  effort: PROVIDER_DEFAULTS.openai.effort,
  fastMode: false,
  wakeName: "Navi",
  listenMode: "handsfree",
  sessionTimeoutSec: 120,
  feedback: "minimal",
  speechRate: 1.0,
  volume: 0.6,
  routerModel: PROVIDER_DEFAULTS.openai.routerModel,
  voiceName: "",
  lang: "en-US",
  allowCloudSpeech: true,
  allowPageText: true,
  allowScreenshots: true,
  typedPageContext: false,
  blockedSites: [],
  maxAgentSteps: 12,
  elevenLabsKey: "",
  speechInput: "elevenlabs",
  speechOutput: "elevenlabs",
  elevenVoiceId: DEFAULT_VOICE_ID,
  elevenModel: "eleven_flash_v2_5",
  filterBackgroundAudio: true,
};

/** The API key for a model's provider ("" if not set). */
export function keyFor(s: Settings, model: string): string {
  return modelInfo(model).provider === "openai" ? s.openaiKey : s.apiKey;
}

/** Which providers have a key, OpenAI first. */
export function providersWithKeys(s: Settings): Provider[] {
  return (["openai", "anthropic"] as Provider[]).filter((p) => (p === "openai" ? s.openaiKey : s.apiKey));
}

/**
 * The settings Navi runs with: a model whose provider has no key is swapped for the defaults of a
 * provider that has one, so an OpenAI-only or Anthropic-only setup just works.
 */
export function withAvailableModels(s: Settings): Settings {
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

/** True when commands should be transcribed by ElevenLabs. */
export function usesElevenInput(s: Settings): boolean {
  return !!s.elevenLabsKey && s.speechInput === "elevenlabs";
}

/** True when Navi should speak with ElevenLabs. */
export function usesElevenOutput(s: Settings): boolean {
  return !!s.elevenLabsKey && s.speechOutput === "elevenlabs";
}

/** Defaults for anything missing, and renames from older versions. */
export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // "Click to talk" ("push") became "Open mic".
  if ((s.listenMode as string) === "push") s.listenMode = "open";
  // Older models are replaced by their current-generation successors.
  s.model = RETIRED_MODELS[s.model] ?? s.model;
  s.routerModel = RETIRED_MODELS[s.routerModel] ?? s.routerModel;
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
