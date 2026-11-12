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

Shipped on 2026-10-02: the main AI can start helpers (4a without a browser, 4b in their own unfocused window), check on them and stop them, and gets their reports back (and since 2026-11-06 can tell a running one more about its task; since 2026-11-12 helpers can ask the user a question with a few options, shown as a card with a ding and spoken only if the user is in that helper's window), like subagents in Claude Code. One time limit (Settings, 15 minutes), a nudge and then a stop for helpers going in circles, listed in the panel with stop buttons. See the changelog. Still open:

- **Web research without a browser (4a):** the provider's own web search tool would let a helper research without opening sites. Before turning it on, check that it meets Navi's rule that every AI service is data private (zero retention).
- **Minimized helper windows:** helpers open normal windows behind the user's. Chrome slows down pages it isn't showing, so minimized windows need measuring first: timers slow down, lazy-loading lists and video don't progress, screenshots don't work, and long-hidden tabs can be frozen.
- **Surviving a restart:** helpers live in Navi's background worker; if Chrome stops it, running helpers end. Since 2026-11-12 their windows are closed and Navi says which helpers stopped; picking up where they left off is still open.

## 5. Talk to a background window while you work — *Partly shipped*

Shipped on 2026-10-02: each command stays in the window it was given in, and Navi can be pinned to one window ("pin Navi to this window") so you can work in another while it works there. Still open:

- **A minimized or hidden Navi window** (see 4b's limits): today the pinned window should stay open on screen, because Chrome slows down pages it isn't showing.
- **Per-thread windows:** tie a thread to a window, so "go back to the shopping thread" also means "work in the shopping window".
- **Showing the pinned window on the page:** the panel shows it today; the caption on web pages could say "Navi works in another window" too.

## 6. First-run tutorial — *Shipped 2026-10-02*

See the changelog. Next: practice steps for dictation and the mouse grid, and a version for switch and keyboard-only users.

## 7. Speech recognition that just works — *Top priority*

Chrome's on-device recognizer is the weak link: short commands misheard as one wrong word, phrases held or dropped, and (fixed on 2026-10-02) restart gaps that made Navi deaf. The fixes help, but the recognizer itself stays a black box.

*Progress, 2026-11-06:* Navi now understands most of what Chrome mishears (156 of 166 realistic mishearings, matching by sound; `tests/unit/hearing.test.ts`), never scrolls the opposite way, acts on a held whole command in 0.5 s instead of 1.1 s, and wakes for more mishearings of "Hey Navi". The usage log now records how each spoken command was heard ("held", the runner-up guesses, timings), and "that's not what I said" marks mistakes, so the next fixes can come from real use instead of guesses. Next: go through a real session's log and fix what it shows. From the research (2026-10-02; Wispr Flow, Superwhisper, Aqua, Talon and others), what works:

- ~~A cloud streaming recognizer~~ (Soniox, Deepgram Flux, ElevenLabs Scribe): ruled out by the owner on 2026-11-11. Recognition stays on the computer, and Navi pays for no service except OpenAI for the AI.
- **Better on-device listening (Free, and Pro's fallback):** Chrome's phrase boosting for the commands (tested before and removed for false "hearing" in noise; retry with weaker boosts and only while awake), and a command grammar over the recognizer's guesses.

*Research, 2026-11-12 (on-device and free only, Navi under 4–6 GB of memory):*

- **Smart end-of-turn detection (most promising next step):** Pipecat's Smart Turn v3, an 8M-parameter audio model (int8 ONNX about 11 MB, 10–65 ms on a CPU, BSD-2), decides from the voice itself whether the speaker is done. It would let Navi act right away on "close tab" yet wait through "search for… um… red shoes", instead of fixed timers. It runs in the offscreen page with onnxruntime-web, which Parakeet already loads, on the same mic stream (`start(track)`).
- **Chrome's phrase boosting (`SpeechRecognitionPhrase`, Chrome 142+):** boost is roughly the natural log of how much likelier a phrase is (1 ≈ 3×, 3 ≈ 20×). Retry at boost 1 or less, only while awake, and A/B it against the usage log. Chrome fires `phrases-not-supported` where it can't, which must fall back quietly.
- **Chrome's quality hint** (`quality: "command" | "dictation" | "conversation"` in `available()`/`install()`, approved in 2026): it may get a better on-device model for dictation. Watch for it to ship.
- **A real wake word:** livekit-wakeword (open source; trainer plus a browser client on onnxruntime-web; its makers report 89% detection against openWakeWord's 46% at the same false-alarm rate). It needs a "Hey Navi" model trained once from synthetic voices.
- **Moonshine v2** (streaming, English, 34M–200M parameters, about 80–200 MB): a lighter alternative to Parakeet with live captions word by word. There's no official browser build yet, only community ONNX exports, so it's a later experiment.
- **The AI side:** browser agents spend most of their time waiting on the model, not the browser. Navi already does what the research recommends: built-in commands with no AI for mechanical steps, an element list first (screenshots only as a fallback), low reasoning and prompt caching. Next: run repeated tasks from cached plans instead of re-asking the model each step (the "Agent JIT" and "Skim" papers report 1.3–10× speedups).
- **A real wake word:** a small "Hey Navi" model trained with openWakeWord or livekit-wakeword (open source; runs in the browser), instead of finding the name in the recognizer's text. It fires first; the recognizer confirms.
- **Push-to-talk** for people who can press a key or a switch: the most reliable input there is, and what dictation power users use.

## 8. Voice ID — *Planned*

Navi learns the user's voice (about 30 seconds, once) and ignores other people: for loud rooms like the research expo, cafes and shared offices. An on-device speaker-check model (e.g. WeSpeaker, 3D-Speaker CAM++ or SpeechBrain ECAPA, all Apache-2.0) compares each phrase with the user's voice print.

- **Adaptive:** checking every phrase adds a little delay and can drop the user's own commands, so it switches on only when other voices are getting in: phrases that don't match the voice print, speech while the user is silent, or commands misheard in a row. In a quiet room with one speaker it stays off.
- **First, the free wins:** a close or directional mic (a headset or podium mic, as Theo Browne uses), Chrome's noise suppression (on), and push-to-talk for demos.
- Separating overlapping speakers (diarization, e.g. NVIDIA's Nemotron 3 Diarization) only if voice ID isn't enough.

## Earlier ideas

- **Download and demo website** — *Idea.* A one-page site (GitHub Pages) for the launch: a download link (Chrome Web Store once listed, a GitHub release until then), the one-time setup steps, a short demo video of a hands-free task and a productivity task, and who Navi is for.
- **Older Chrome versions** — *Idea.* Some Chrome versions block speech recognition in background pages, and Navi asks you to update Chrome. A fallback that listens from the side panel would cover them.
- **Voice ID** — *Idea.* Optional enrollment on the setup page so that, during a session, only your voice is acted on (Picovoice Eagle or WeSpeaker ONNX); see `docs/research/wake-word-and-voice-id.md`.
- **Dedicated wake-word model** — *Idea.* A small model trained on "Hey Navi" (Porcupine or openWakeWord). It would be more reliable than finding the name in the recognizer's text, and lighter than transcribing everything.
- **Recorded commands** — *Idea.* About 50 real recordings, to measure speech recognition and routing end to end; NaviBench already covers tasks, latency and cost.
