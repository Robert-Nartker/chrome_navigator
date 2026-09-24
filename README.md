# Navi: voice browser agent

Navigate Chrome with your voice. Say **"Hey Navi"** once, then keep talking: "open YouTube", "search for lofi beats", "scroll down", "click 12", "reply to Sarah saying I'll be late". Navi stays awake while you keep giving commands and goes back to sleep after two quiet minutes, or when you say "go to sleep".

Built for two groups:
- **Accessibility:** people with motor impairments who can't use a mouse and keyboard, and blind or low-vision users, via spoken feedback and "read this page" / "where am I".
- **Speed:** developers and power users who want to browse hands-free.

BDAA AI Fundamentals track project, Autumn 2026.

## Quick start

```bash
npm install
npm run build          # outputs the extension to dist/
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `dist/` folder.
2. A setup tab opens. Click **Allow microphone**. Chrome only lets extensions ask for the mic from a normal tab, so this one-time step is required.
3. Pin Navi (puzzle-piece menu), then click its icon or press **Alt+Shift+N** to open the side panel.
4. Optional: open **Settings** and paste a Claude API key to turn on the AI for open-ended commands. Basic commands work without a key.

While developing, run `npm run watch` and click the reload icon on `chrome://extensions` after changes.

## What you can say

| Kind | Examples |
|---|---|
| Wake / sleep | "Hey Navi" … "go to sleep", "that's all" |
| Scroll | "scroll down", "scroll up a little", "go to the top", "page down" |
| Pages | "go back", "forward", "refresh" |
| Sites | "open YouTube", "go to github dot com", "open gmail in a new tab" |
| Search | "search for pizza near me", "search YouTube for lofi", "look up AirPods on Amazon" |
| Tabs | "new tab", "close tab", "next tab", "tab 3", "switch to YouTube", "reopen closed tab", "what tabs are open" |
| Click | "show numbers" then "click 12"; or "click sign in" |
| Type | "type hello world", "type cats into 5 and press enter", "press enter", "escape" |
| Media | "pause", "play", "skip ahead 30 seconds", "mute" |
| Reading | "read this page", "where am I", "zoom in" |
| Anything else (AI) | "open the first video", "reply to this email saying thanks", "what's this article about?", "add this to my cart" |
| Control | "stop" (interrupts speech or a running task), "what can I say" |

You can also type commands in the side panel.

## How it works

```
 mic ──► speech-to-text ──► wake/session gate ──► fast-path parser ──► action
          (Chrome, on-device    ("Hey Navi" once,     (regex, ~50 ms,       │
           when supported)       then a session)        no AI, no network)  │
                                                            │ not matched   │
                                                            ▼               │
                                              Claude agent (tool use) ──────┤
                                              sees element labels only      ▼
                                                                  content script acts on the page
                                                                  (click / type / scroll / read)
                                                                            │
                                                  spoken reply (chrome.tts) ◄┘
```

- **Side panel** (`src/sidepanel/`): mic, wake-word session, command pipeline, log.
- **Content script** (`src/content/`): builds a "snapshot" of the page's interactive elements named the way a screen reader would name them (ARIA labels, `<label>`, alt text), draws number badges, and performs clicks, typing, scrolling and reading. It also finds clickable `div`s that only have `cursor: pointer`, and scrolls inner panels (Gmail, Slack) as well as the page.
- **Fast path** (`src/lib/parser.ts`): common commands run instantly with no AI call.
- **AI path** (`src/lib/agent.ts`): Claude gets the command plus a compact element list (`[12] button "Sign in"`) and calls tools: `click`, `type_text`, `scroll`, `navigate`, `switch_tab`, `press_key`, `read_page`, and a few more. After each action it gets a fresh snapshot, and it finishes with one short spoken sentence. Default model is Claude Opus 5 at low effort. Haiku 4.5 and Sonnet 5 can be picked in settings.

## Privacy model

- **Audio:** Navi uses Chrome's speech recognizer in on-device mode when available (Chrome 139+; download the model once on the setup page). Then audio never leaves your computer, including while Navi listens for its name. If on-device isn't available, Chrome falls back to Google's speech service while the mic is on. You can turn that fallback off in settings, and the side panel log says which mode is active.
- **Nothing is acted on until the wake word.** Speech before "Hey Navi" is ignored and never shown or sent to the AI.
- **The AI sees labels, not content.** By default Claude receives only the names of buttons, links and fields. It reads page text only when a request needs it (read, summarize, answer a question), and you can turn that off. Password fields are never included.
- **"Read this page" is local.** Reading aloud never involves the AI.
- **Blocked sites:** list sites (your bank, health portal) where the AI is never used.
- **Confirmation:** the agent asks before sending, posting, buying or deleting.
- **Prompt injection:** page text is marked as untrusted data, and the agent is told never to follow instructions found in it.
- **API key:** stored in `chrome.storage.local` in your browser profile only.

## Development

```bash
npm run typecheck   # TypeScript (tsgo)
npm test            # unit tests: parser, label matching, wake session (vitest)
npm run test:e2e    # builds, loads the extension in Chromium, drives real pages (Playwright)
npm run check       # all of the above
node scripts/probe-sites.mjs [urls...]   # snapshot quality on real sites (element counts, size, timing)
```

The e2e suite covers clicking by label and by number, badges, scrolling, typing and submitting, navigation and tabs, restricted pages, the wake session, blocked sites, and a full AI turn against a mocked Claude API (checking that page text isn't sent). If Playwright's browser isn't installed yet, run `npx playwright install chromium` once.

## Roadmap

- **Listening with the side panel closed:** move audio into an offscreen document (Web Speech works there from Chrome 150), with command execution in the service worker
- **Voice ID:** optional enrollment on the setup page so only your voice is acted on during a session (Picovoice Eagle or WeSpeaker ONNX); see `docs/research/wake-word-and-voice-id.md`
- **Dedicated wake-word engine** (Porcupine / openWakeWord) for lower CPU than running recognition continuously
- **Streaming cloud speech-to-text option** (ElevenLabs Scribe v2 Realtime or Soniox) with an accuracy/latency comparison; see `docs/research/speech-to-text.md`
- **Evaluation harness:** about 50 recorded commands plus a task suite, measuring task success, latency and cost for fast path vs AI and across models
