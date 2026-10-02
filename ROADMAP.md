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

Shipped on 2026-10-02: the main AI can start helpers (4a without a browser, 4b in their own unfocused window), supervised with step, time and cost limits and stuck detection, listed in the panel with stop buttons. See the changelog. Still open:

- **Web research without a browser (4a):** the provider's own web search tool would let a helper research without opening sites. Before turning it on, check that it meets Navi's rule that every AI service is data private (zero retention).
- **Questions from helpers:** today a helper that needs the user's OK stops and reports what's ready; a question queue (the panel shows it, Navi asks at a quiet moment, the helper continues) would let it finish the job.
- **Minimized helper windows:** helpers open normal windows behind the user's. Chrome slows down pages it isn't showing, so minimized windows need measuring first: timers slow down, lazy-loading lists and video don't progress, screenshots don't work, and long-hidden tabs can be frozen.
- **Surviving a restart:** helpers live in Navi's background worker; if Chrome stops it, running helpers end (their windows stay open).
- **Limits in Settings:** the 15 steps / 5 minutes / $0.50 limits are fixed today.

## 5. Talk to a background window while you work — *Partly shipped*

Shipped on 2026-10-02: each command stays in the window it was given in, and Navi can be pinned to one window ("pin Navi to this window") so you can work in another while it works there. Still open:

- **A minimized or hidden Navi window** (see 4b's limits): today the pinned window should stay open on screen, because Chrome slows down pages it isn't showing.
- **Per-thread windows:** tie a thread to a window, so "go back to the shopping thread" also means "work in the shopping window".
- **Showing the pinned window on the page:** the panel shows it today; the caption on web pages could say "Navi works in another window" too.

## 6. First-run tutorial — *Idea*

A short spoken walkthrough for new users. It covers waking Navi ("Hey Navi" or "Hey Navigator"), a few commands to try, how to stop and how to turn it off, and where Settings are. It must work without looking at the screen, since the one-time mic and on-device speech setup is the only step that needs clicks.

## Earlier ideas

- **Older Chrome versions** — *Idea.* Some Chrome versions block speech recognition in background pages, and Navi asks you to update Chrome. A fallback that listens from the side panel would cover them.
- **Voice ID** — *Idea.* Optional enrollment on the setup page so that, during a session, only your voice is acted on (Picovoice Eagle or WeSpeaker ONNX); see `docs/research/wake-word-and-voice-id.md`.
- **Dedicated wake-word model** — *Idea.* A small model trained on "Hey Navi" (Porcupine or openWakeWord). It would be more reliable than finding the name in the recognizer's text, and lighter than transcribing everything.
- **Recorded commands** — *Idea.* About 50 real recordings, to measure speech recognition and routing end to end; NaviBench already covers tasks, latency and cost.
