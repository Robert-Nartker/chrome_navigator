// User settings, stored locally in this browser profile (chrome.storage.local).

import { DEFAULT_VOICE_ID } from "./elevenlabs";

export type ListenMode = "handsfree" | "push";
export type Feedback = "minimal" | "spoken";

export interface Settings {
  apiKey: string;
  model: string;
  effort: "low" | "medium" | "high";
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

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" },
  { id: "claude-opus-5", label: "Claude Opus 5" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest)" },
] as const;

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
  fastMode: false,
  wakeName: "Navi",
  listenMode: "handsfree",
  sessionTimeoutSec: 120,
  feedback: "minimal",
  speechRate: 1.0,
  volume: 0.6,
  routerModel: "claude-sonnet-5",
  voiceName: "",
  lang: "en-US",
  allowCloudSpeech: true,
  allowPageText: true,
  allowScreenshots: true,
  blockedSites: [],
  maxAgentSteps: 12,
  elevenLabsKey: "",
  speechInput: "elevenlabs",
  speechOutput: "elevenlabs",
  elevenVoiceId: DEFAULT_VOICE_ID,
  elevenModel: "eleven_flash_v2_5",
  filterBackgroundAudio: true,
};

/** True when commands should be transcribed by ElevenLabs. */
export function usesElevenInput(s: Settings): boolean {
  return !!s.elevenLabsKey && s.speechInput === "elevenlabs";
}

/** True when Navi should speak with ElevenLabs. */
export function usesElevenOutput(s: Settings): boolean {
  return !!s.elevenLabsKey && s.speechOutput === "elevenlabs";
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export function onSettingsChanged(callback: (settings: Settings) => void) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      callback({ ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<Settings>) });
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
