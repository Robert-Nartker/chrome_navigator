// Message protocol between the side panel (which runs the command pipeline) and
// the content script (which reads and acts on the page).

export type ScrollDirection = "up" | "down" | "left" | "right" | "top" | "bottom";
export type ScrollAmount = "small" | "page" | "large";

export const KEYS = [
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "Backspace",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
] as const;
export type Key = (typeof KEYS)[number];

export type MediaAction =
  | "play"
  | "pause"
  | "toggle"
  | "mute"
  | "unmute"
  | "forward"
  | "rewind"
  | "fullscreen";

export type ContentRequest =
  | { kind: "ping" }
  | { kind: "snapshot" }
  | { kind: "showBadges" }
  | { kind: "hideBadges" }
  | { kind: "click"; id: number; gen?: number }
  | { kind: "type"; id?: number; gen?: number; text: string; submit: boolean; clear: boolean }
  | { kind: "select"; id: number; gen?: number; option: string }
  | { kind: "scroll"; direction: ScrollDirection; amount: ScrollAmount }
  | { kind: "pressKey"; key: Key }
  | { kind: "readPage"; maxChars: number }
  | { kind: "media"; action: MediaAction; seconds?: number };

export interface ElementInfo {
  /** Number shown on the badge; valid for the snapshot generation it came from. */
  id: number;
  role: string;
  name: string;
  tag: string;
  inputType?: string;
  href?: string;
  value?: string;
  checked?: boolean;
  inViewport: boolean;
}

export interface PageSnapshot {
  gen: number;
  url: string;
  title: string;
  elements: ElementInfo[];
  scrollY: number;
  scrollMax: number;
  focusedId?: number;
  dialogOpen: boolean;
}

export type ContentResponse =
  | { ok: true; snapshot?: PageSnapshot; text?: string; detail?: string }
  | { ok: false; error: string };
