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
  | "fullscreen"
  | "exitFullscreen"
  | "faster"
  | "slower"
  | "normalSpeed"
  | "volumeUp"
  | "volumeDown"
  | "volume"
  | "restart";

export type EditAction = "selectAll" | "undo" | "clear" | "newline";

/** How the mouse grid presses the mouse at the chosen spot. */
export type GridClick = "click" | "doubleClick" | "rightClick";
export type GridAction = "show" | "zoom" | "back" | "hide" | GridClick;

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
  | { kind: "typeKeys"; text: string; submit: boolean }
  | { kind: "readPage"; maxChars: number }
  | { kind: "media"; action: MediaAction; seconds?: number; volume?: number }
  // Cells are keypad numbers 1-9, one per grid level: [5, 3] is block 3 inside block 5.
  // `image` (on show) is a picture of the tab taken before the grid covers it, to magnify small blocks.
  | { kind: "grid"; action: GridAction; cells?: number[]; image?: string }
  | { kind: "clickAt"; x: number; y: number }
  | { kind: "autoScroll"; action: "start" | "stop" | "faster" | "slower" }
  | { kind: "find"; text?: string }
  | { kind: "edit"; action: EditAction }
  | { kind: "print" };

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
  /** Viewport size in CSS pixels (to map screenshot coordinates back to the page). */
  viewport: { width: number; height: number };
}

export type ContentResponse =
  | { ok: true; snapshot?: PageSnapshot; text?: string; detail?: string; gridActive?: boolean; active?: boolean }
  | { ok: false; error: string };
