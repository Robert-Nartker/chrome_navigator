# Roadmap

Planned changes and ideas for Navi. Shipped work is in [CHANGELOG.md](CHANGELOG.md): when an item here ships, it moves there.

**Status:** *Idea* (worth exploring) → *Planned* (agreed, not started) → *In progress* → shipped (moved to the changelog).

Most of what's next shares one theme: **several agents, windows and tasks at once**, without them stepping on each other or on the user. Items 4 and 5 build on the shared groundwork below. (Items 1–3 and parts of 4 and 5 have shipped.)

## Shared groundwork for concurrency

Today Navi runs one agent at a time, and every action targets "the tab the user is looking at". Running several at once needs:

- **Agent targets.** Each agent is bound to its own window (and the tabs it opened) instead of the focused tab. *Started:* a command is bound to its window for as long as it runs; running several agents in different windows at once is next.
- **Locks.** At most one agent drives a given window. Changes to Navi's settings, personal commands and memory go through a single writer, so two agents can't edit them at once.
- **A supervisor.** *Shipped for helpers:* a step limit, a time limit and a cost budget, plus stuck detection (the same action repeated with no change on the page). A stuck or runaway helper is stopped and reported. "Stop everything" ends the command and all helpers. The side panel lists what's running, with a stop button for each.
- **Questions from agents the user isn't watching.** A background agent that needs a yes ("send it?") or is stuck waits in a queue. The panel shows it, and Navi says it out loud at a quiet moment instead of interrupting.
- **Speech.** Replies from several agents are queued, never spoken over each other, and say where they come from ("Background task: …").

Threads (item 1), memory (item 2) and Free/Pro presets (item 3) shipped on 2026-10-02; see the changelog. Threads run one command at a time; running several at once needs the groundwork above.

## 4. Subagents and background Navi — *Partly shipped*

Shipped on 2026-10-02: the main AI can start helpers (4a without a browser, 4b in their own unfocused window), check on them and stop them, and gets their reports back, like subagents in Claude Code. One time limit (Settings, 15 minutes), a nudge and then a stop for helpers going in circles, listed in the panel with stop buttons. See the changelog. Still open:

- **Web research without a browser (4a):** the provider's own web search tool would let a helper research without opening sites. Before turning it on, check that it meets Navi's rule that every AI service is data private (zero retention).
- **Questions from helpers:** today a helper that needs the user's OK stops and reports what's ready; a question queue (the panel shows it, Navi asks at a quiet moment, the helper continues) would let it finish the job.
- **Minimized helper windows:** helpers open normal windows behind the user's. Chrome slows down pages it isn't showing, so minimized windows need measuring first: timers slow down, lazy-loading lists and video don't progress, screenshots don't work, and long-hidden tabs can be frozen.
- **Surviving a restart:** helpers live in Navi's background worker; if Chrome stops it, running helpers end (their windows stay open).
- **Messages to a running helper:** the main AI can check and stop helpers, but not yet steer one ("also check Best Buy").

## 5. Talk to a background window while you work — *Partly shipped*

Shipped on 2026-10-02: each command stays in the window it was given in, and Navi can be pinned to one window ("pin Navi to this window") so you can work in another while it works there. Still open:

- **A minimized or hidden Navi window** (see 4b's limits): today the pinned window should stay open on screen, because Chrome slows down pages it isn't showing.
- **Per-thread windows:** tie a thread to a window, so "go back to the shopping thread" also means "work in the shopping window".
- **Showing the pinned window on the page:** the panel shows it today; the caption on web pages could say "Navi works in another window" too.

## 6. First-run tutorial — *Shipped 2026-10-02*

See the changelog. Next: practice steps for dictation and the mouse grid, and a version for switch and keyboard-only users.

## 7. Speech recognition that just works — *Top priority*

Chrome's on-device recognizer is the weak link: short commands misheard as one wrong word, phrases held or dropped, and (fixed on 2026-10-02) restart gaps that made Navi deaf. The fixes help, but the recognizer itself stays a black box. From the research (2026-10-02; Wispr Flow, Superwhisper, Aqua, Talon and others), what works:

- **A cloud streaming recognizer, only while Navi is awake (Pro).** Soniox (about $0.12 an hour of streaming, nothing stored by default), Deepgram Flux (built-in end-of-turn detection) or ElevenLabs Scribe v2 Realtime, over a WebSocket from Navi's background page, with Navi's commands and the page's labels sent as key terms. A local voice detector opens the stream only while someone talks, so a day costs cents. Audio leaves the computer, so it's opt-in, with zero retention.
- **Better on-device listening (Free, and Pro's fallback):** Chrome's phrase boosting for the commands (tested before and removed for false "hearing" in noise; retry with weaker boosts and only while awake), and a command grammar over the recognizer's guesses.
- **A real wake word:** a small "Hey Navi" model trained with openWakeWord or livekit-wakeword (open source; runs in the browser), instead of finding the name in the recognizer's text. It fires first; the recognizer confirms.
- **Push-to-talk** for people who can press a key or a switch: the most reliable input there is, and what dictation power users use.

## 8. Voice ID — *Planned*

Navi learns the user's voice (about 30 seconds, once) and ignores other people: for loud rooms like the research expo, cafes and shared offices. An on-device speaker-check model (e.g. WeSpeaker, 3D-Speaker CAM++ or SpeechBrain ECAPA, all Apache-2.0) compares each phrase with the user's voice print.

- **Adaptive:** checking every phrase adds a little delay and can drop the user's own commands, so it switches on only when other voices are getting in: phrases that don't match the voice print, speech while the user is silent, or commands misheard in a row. In a quiet room with one speaker it stays off.
- **First, the free wins:** a close or directional mic (a headset or podium mic, as Theo Browne uses), Chrome's noise suppression (on), and push-to-talk for demos.
- Separating overlapping speakers (diarization, e.g. NVIDIA's Nemotron 3 Diarization) only if voice ID isn't enough.

## Earlier ideas

- **Older Chrome versions** — *Idea.* Some Chrome versions block speech recognition in background pages, and Navi asks you to update Chrome. A fallback that listens from the side panel would cover them.
- **Voice ID** — *Idea.* Optional enrollment on the setup page so that, during a session, only your voice is acted on (Picovoice Eagle or WeSpeaker ONNX); see `docs/research/wake-word-and-voice-id.md`.
- **Dedicated wake-word model** — *Idea.* A small model trained on "Hey Navi" (Porcupine or openWakeWord). It would be more reliable than finding the name in the recognizer's text, and lighter than transcribing everything.
- **Recorded commands** — *Idea.* About 50 real recordings, to measure speech recognition and routing end to end; NaviBench already covers tasks, latency and cost.
