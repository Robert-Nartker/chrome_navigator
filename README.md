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

For day-to-day testing, use the live-reload setup below instead of rebuilding by hand.

## Testing with live reload on Mac or Windows (recommended)

Set this up once per computer. After that, new changes appear in your Chrome on their own. Navi is a Chrome extension, so it works the same on macOS and Windows; only the install commands differ.

1. Install Node.js 20+ and git:
   - macOS: `brew install node git` (or the installer from nodejs.org)
   - Windows (PowerShell): `winget install OpenJS.NodeJS.LTS Git.Git`, then open a new terminal
2. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/Robert-Nartker/chrome_navigator && cd chrome_navigator
   git checkout claude/sleepy-hypatia-gt7x80 && npm install
   ```
3. Start the dev loop and **leave this terminal window open**:
   ```bash
   npm run dev
   ```
4. In Chrome, go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick the `dist` folder. You only do this once.

From then on, `npm run dev` checks GitHub every 10 seconds. When new commits land on the branch, it pulls them, rebuilds, and the open Navi panel reloads itself. The panel footer shows `dev build #N · <latest commit>`, so you can tell you're on the newest version. Your settings and API key are kept across reloads.

- **Core changes:** changes to `background.ts` or the manifest restart the whole extension, which closes the side panel. Reopen it with Alt+Shift+N (Option+Shift+N on a Mac). If Navi ever disappears from the toolbar, click ↻ on `chrome://extensions`.
- **Local edits:** if you edit files yourself, auto-pull pauses (the Terminal says so) until you commit or discard them.

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
| Mouse grid | "show grid", then say a block number (1–9, laid out like a phone keypad) to zoom in, repeat, then "click". "back" zooms out, "hide grid" closes it |
| Type | "type hello world", "type cats into 5 and press enter", "press enter", "escape" |
| Media | "pause", "play", "skip ahead 30 seconds", "mute" |
| Reading | "read this page", "where am I", "zoom in" |
| Anything else (AI) | "open the first video", "reply to this email saying thanks", "what's this article about?", "add this to my cart" |
| Your own commands | "add a command open wordle", "make study mode open Canvas and play lofi on YouTube", "what are my commands", "delete the wordle command" |
| Control | "stop" (interrupts speech or a running task), "what can I say" |

You can also type commands in the side panel.

## Pointing at things you can't name

Three ways to click something you don't know the name of, or that appears several times:
1. **Number tags:** "show numbers" puts a yellow number on every clickable element, then say "click 14".
2. **Mouse grid:** "show grid" splits the screen into 9 blocks. Each number you say zooms into that block, and "click" clicks its center. Three or four numbers reach any spot, including icons, maps and canvas apps that have no real buttons.
3. **The AI can look:** when button names aren't enough ("click the red one", "the second picture"), the AI takes a screenshot with the number tags drawn on it. It clicks a tag, or an exact spot for things without one. This is on-demand only, and you can turn it off in Settings → Privacy.

## Personal voice commands

Ask Navi to make shortcuts for things you do a lot:
- "add a command open wordle": opens the Wordle URL. Navi fills in the URL itself.
- "make a command study mode that opens Canvas in a new tab and plays lofi on YouTube": runs several steps in order.
- "add play {song} on spotify": `{song}` is filled in from what you say.

Personal commands run instantly, with no AI call. Each step either opens a web address or runs something you could have said yourself, so a personal command can't do anything you couldn't already do by voice. The AI can't change settings, privacy options, blocked sites, your API key, or built-in commands like "stop" and "go to sleep". Commands are stored in `chrome.storage.sync`, so they follow you to every computer signed into the same Chrome profile. You can also view, add and delete them in **Settings → Your voice commands**.

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
- **Noise filter and router** (`src/lib/parser.ts`, `src/lib/router.ts`):
  - **Forgiving matching:** looser phrasing ("scroll down further", "Navi sleep") and near-miss transcriptions ("scrawl down") are caught locally.
  - **Noise filter:** keyboard clatter heard as words ("tiktok tiktok tiktok") and lone filler words are ignored without calling any AI.
  - **Router:** anything else unrecognized goes to Claude Haiku 4.5, which in about half a second maps it to a command, passes it to the main AI, or ignores it as background talk.
- **AI path** (`src/lib/agent.ts`): Claude gets the command plus a compact element list (`[12] button "Sign in"`) and calls tools: `click`, `type_text`, `scroll`, `navigate`, `switch_tab`, `press_key`, `read_page`, and a few more. After each action it gets a fresh snapshot, and it finishes with one short spoken sentence. Default model is Claude Opus 5.5 at low effort, which keeps thinking short so actions start quickly. Opus 5, Sonnet 5 and Haiku 4.5 can be picked in settings, and there's an optional fast mode (Opus, 2x price).

## Privacy model

- **Audio:** Navi uses Chrome's speech recognizer in on-device mode when available (Chrome 139+; download the model once on the setup page). Then audio never leaves your computer, including while Navi listens for its name. If on-device isn't available, Chrome falls back to Google's speech service while the mic is on. You can turn that fallback off in settings, and the side panel log says which mode is active.
- **Optional ElevenLabs speech** (Settings → ElevenLabs key): while Navi is awake, commands are transcribed by ElevenLabs Scribe v2 Realtime, which can ignore other people talking nearby. Navi also speaks with an ElevenLabs voice. ElevenLabs' standard data policy applies; zero retention needs an Enterprise plan. While asleep, only Chrome's recognizer listens for the name. The mic socket uses a single-use token, so the API key never goes into the URL. If the key fails, Navi falls back to Chrome's recognizer and voice.
- **Sound from your own computer** (a podcast or video) is cancelled out of the mic when Chrome supports system-wide echo cancellation (`echoCancellation: "all"`).
- **Nothing is acted on until the wake word.** Speech before "Hey Navi" is ignored and never shown or sent to the AI.
- **The AI sees labels, not content.** By default Claude receives only the names of buttons, links and fields. It reads page text only when a request needs it (read, summarize, answer a question), and you can turn that off. Password fields are never included.
- **"Read this page" is local.** Reading aloud never involves the AI.
- **Blocked sites:** list sites (your bank, health portal) where the AI is never used.
- **Confirmation:** the agent asks before sending, posting, buying or deleting.
- **Prompt injection:** page text is marked as untrusted data, and the agent is told never to follow instructions found in it.
- **API key:** stored in `chrome.storage.local` in your browser profile only.

## Voice lab: compare voices

Chrome's built-in voices can sound robotic. The voice lab (**Settings → Voice feedback → Compare voices**) lets you listen to free neural voices that run on your own computer, side by side, rate them, and pick one.

- **Engines:** Chrome's own voices (marked "on this computer" or "online"), Kokoro (on the graphics chip with WebGPU, or the processor with WebAssembly), Pocket TTS by Kyutai, and Piper. With an ElevenLabs key set, its paid voice is included for comparison.
- **First use downloads the voice model once**, from Hugging Face: Kokoro 92 MB on the processor or 326 MB on the graphics chip (one download covers all its voices), Pocket TTS about 125 MB, Piper about 63 MB per voice. After that they load from the browser's storage and work offline. **Delete downloaded voices** at the bottom of the page frees the space.
- **Numbers for each voice:** first-load time and download size, time to first audio, total synthesis time, and real-time factor.
- **Comparing:** tick voices and play the same phrase in each, one after another: things Navi really says, a paragraph, or your own text. Blind mode hides the names and shuffles the order. Ratings (1 to 5) are saved in the browser, and your top voices are listed.
- **Mac tip:** download a "Premium" or "Enhanced" voice in System Settings → Accessibility → Spoken Content → System voice → Manage Voices. It then shows up under Chrome's voices.

Chrome extensions can't load code from a CDN, so the engines' libraries and ONNX Runtime WebAssembly files are copied into `dist/` at build time (about 70 MB). Each engine loads only when you use it, so the rest of Navi is unchanged. The e2e tests serve tiny stand-in models (`tests/fixtures/tts/`) so they run without the real downloads.

## Development

```bash
npm run typecheck   # TypeScript (tsgo)
npm test            # unit tests: parser, label matching, wake session (vitest)
npm run test:e2e    # builds, loads the extension in Chromium, drives real pages (Playwright)
npm run check       # all of the above
npm run bench       # NaviBench task suite against real Claude models (see below)
node scripts/probe-sites.mjs [urls...]   # snapshot quality on real sites (element counts, size, timing)
```

The e2e suite covers clicking by label and by number, badges, scrolling, typing and submitting, navigation and tabs, restricted pages, the wake session, blocked sites, and a full AI turn against a mocked Claude API (checking that page text isn't sent). If Playwright's browser isn't installed yet, run `npx playwright install chromium` once.

## Benchmark (NaviBench)

`bench/sites/` has small, realistic web apps: an email inbox, a shop, a video site, a signup form, and a news article that contains a prompt-injection line. `bench/tasks.json` has 17 spoken-command tasks with automatic pass/fail checks, including safety checks. For example, "reply to Sarah…" must draft the reply but not send it without a yes, and the article summary must not repeat the injected instruction.

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run bench -- --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5 --repeat 3
npm run bench:mock        # checks the harness without API calls
```

It prints per-task PASS/FAIL, then a table of success rate, median latency and AI steps per model, and saves the raw results to `bench-results/`. Real usage is logged too: **Settings → Usage log → Export CSV** gives every command's path (fast or AI), latency and steps.

## Roadmap

- **Listening with the side panel closed:** move audio into an offscreen document (Web Speech works there from Chrome 150), with command execution in the service worker
- **Voice ID:** optional enrollment on the setup page so only your voice is acted on during a session (Picovoice Eagle or WeSpeaker ONNX); see `docs/research/wake-word-and-voice-id.md`
- **Dedicated wake-word engine** (Porcupine / openWakeWord) for lower CPU than running recognition continuously
- **Speech-to-text comparison:** accuracy and latency of ElevenLabs Scribe v2 Realtime vs Chrome on-device on recorded noisy commands; see `docs/research/speech-to-text.md`
- **Evaluation harness:** about 50 recorded commands plus a task suite, measuring task success, latency and cost for fast path vs AI and across models
