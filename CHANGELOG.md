# Changelog

What changed in Navi, newest first. Planned work is in [ROADMAP.md](ROADMAP.md); when a roadmap item ships, it moves here.

## 2026-10-01

- **On from the moment Chrome starts.** Once the mic is allowed, Navi listens for "Hey Navi" as soon as Chrome opens, with nothing to click. Each Chrome session starts in Hey Navi mode; Open mic is only on when chosen.
- **Off means off.** Turning Navi off (mic button, Alt+Shift+M, or "turn off") closes the mic and keeps it closed across restarts and panel opens until it's turned on again.
- **"Hey Navigator"** wakes Navi too: a dictionary word that recognizers spell reliably.
- Costs show to the cent ("$0.03"; under half a cent is "<$0.01").
- **Performance:** nothing animates while Navi just listens (the pill's backdrop blur and nonstop animations made Chrome redraw every frame; about 4–6× less CPU). Parakeet does less live work and hands back to Chrome's recognizer if it can't keep up; Chrome's recognizer can't restart in a tight loop.
- Codebase cleanup: dead code, duplicates, stale comments and docs; shared e2e test helpers; screenshots refreshed.

## 2026-09-30

- **YOLO mode:** acts without asking (except payments, financial details and passwords), no step limit. The default mode asks only before sending, posting, buying, deleting, or closing a tab with unsent typing.
- **Open vs go to:** "open" opens a new tab, "go to" stays in this one, whatever the phrasing; "go back" in a tab opened from another closes it and returns there.
- Context-dependent phrases ("turn it up", "turn it to 30") go to the router and AI, which now see what Navi last said, instead of being hardcoded.
- Volume levels ("volume 45"); video commands on pages without a video go to the AI.
- **Talk over Navi** to cut it short; "stop" works any time, even asleep; confirmations chime instead of being read aloud.
- **Parakeet** (NVIDIA, on-device) as an alternative recognizer; Chrome's stays the default.
- Navi's voice is a bit faster and starts sooner (first clause first, warm-up after loading).
- The agent can type into pages that listen to the keyboard; clicks that don't load a page no longer wait half a second.
- Side panel **Thinking switch** (Low / Medium / Extra high); 20-step default limit; drafts are prepared before "send it?".
- Research report and chart: computer-use performance vs cost across models and reasoning levels.

## 2026-09-29

- **GPT-6.1 Sol** is the default agent model; "Extra high" and "Max" reasoning for OpenAI and Claude 5.5 models.
- **Navi's voice:** Kokoro, an on-device neural voice (ElevenLabs removed: zero retention needs its Enterprise plan).
- **Navi Free:** on-device chat and routing with Gemini Nano, and a Free/Pro switch.
- Speech recognition runs on-device only.
- The router judges all unrecognized speech, sees the last three commands, and one request can both answer and act.
- With the panel closed: talk-now shortcut, address-bar typing ("navi" keyword), replies shown on the page.
- Speech lab and recognizer tester (Qwen3-ASR, Parakeet, Whisper; Silero VAD).
- NaviBench: six harder browser tasks, `--relay`, `--max-steps`.

## 2026-09-28

- Current-generation models only, with defaults for each provider.
- Setup connects an AI key in one step.

## 2026-09-26

- Typed chat with the main AI, dictation into the chat box, and a fix for the mic on fresh setups.

## 2026-09-25

- **Navi keeps working with the side panel closed** (background worker and offscreen "ears").
- Side panel redesign: live caption, one card per command with collapsible steps; neutral, compact look.
- Mouse grid redesign: nested previews, multi-number zoom, magnifier.
- Flags (numbered tags on clickable things); safer closing (by name, with confirmation for loose speech).
- Personal voice commands created by asking the AI.
- GPT-6 support with per-command cost; NaviBench router suite and 20-hour cost projection.
- Voice lab to compare on-device voices.
- Open mic mode; fuzzy "Hey Navi"; quieter voice and a noise filter.

## 2026-09-24

- **First version:** a Chrome extension you drive by voice. Fast built-in commands, an AI agent for everything else, on-device speech setup, usage metrics, and the NaviBench task suite.
