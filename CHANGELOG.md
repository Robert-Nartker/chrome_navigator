# Changelog

What changed in Navi, newest first. Planned work is in [ROADMAP.md](ROADMAP.md); when a roadmap item ships, it moves here.

## 2026-10-02

- **Phrases arrive whole.** Chrome splits what you say at short pauses and Navi used to run each piece on its own, so "8 thousand" reached the AI as "8" and "close tab" could run as "close". Navi now joins the pieces: it runs a whole command a moment after you stop (0.2 s) and waits a little longer when what you've said isn't complete yet (0.6 s). A phrase Chrome holds on to is finished without restarting Chrome, so the next command is heard straight away.
- **"Go back"** is the browser's back button and never closes a tab. On a page with nothing to go back to (sites that change filters without adding a page to history), Navi says so, and how to get back to the tab it came from.
- **"Search for …"** on a site uses that site's own search box (Facebook Marketplace, a shop, a forum) instead of leaving for Google; the box for the section you're in wins ("Search Marketplace" over "Search Facebook"). "Google …" still searches the web.
- **The AI on real sites:** it can scroll a side panel or list (a column of filters) by naming an element in it; it's told that a new search from the main search box usually clears filters, and that going back doesn't undo things on a page. On endless pages the element list it gets is capped (150 on screen, 60 off screen), so each step is faster.
- **Push to talk.** Ctrl+Space (the Control key on a Mac) means "listen to me now" in any mode; change it in Chrome's shortcut settings (Settings links there, or say "change the shortcut"). The new **Push to talk** mode keeps the mic closed until you press it, then listens for your command and follow-ups and closes a few quiet seconds later, so AirPods and other Bluetooth headsets keep their good sound the rest of the time. Say "push to talk mode", "open mic mode" or "wake word mode" to switch.
- **"Open the panel" / "close the panel"** by voice. Chrome opens the side panel only from a click or a shortcut, so by voice Navi's panel opens as a small window at the right of your window.
- **Listening fixes** (from real use: commands held for 5–10 s, follow-ups missed, and Navi going deaf for ~10 s every half minute):
  - When Chrome holds on to a phrase (the caption sits there unfinished), Navi finishes it itself after 1.1 s of no change and starts listening again at once. Before, it asked Chrome to finish, which could take seconds or drop the words, while the mic sat in a restart gap.
  - Chrome ends its listening sessions every so often. Navi used to wait longer after each quiet one (up to 8 s, deaf the whole time); now it restarts at once, and only waits after sessions that fail straight away or real mic errors.
  - If the mic hears someone talking for a second and Chrome produces no words for 2.5 s, Navi restarts Chrome's recognizer.
  - A phrase still on screen when Chrome ends a session is run, not thrown away.
  - Chrome's runner-up guesses are used: when its best guess isn't a command but another is ("scroll dune" / "scroll down"), that runs. Never one that closes or clears something.
- **Waking Navi:** it wakes as soon as the caption shows its name, without waiting for Chrome to finish the phrase (which it sometimes dropped, so "Hey Navi" seemed to do nothing). "Wake up" and "wake" work too. Saying the name in Open mic, or while awake, plays the wake sound so you know it heard.
- **Navi's voice (Kokoro) failing** with "byte length of Float32Array should be a multiple of 4": the voice library cached a failed download (an error page) as the voice and failed on it every time. Navi now downloads and checks the voice file itself, replacing a bad copy.
- **Memory and graphics memory:** turning Navi off now closes its background page, freeing its voice model, recognizer, Parakeet and mic. While on, Navi's voice unloads after 10 minutes unused (it reloads when Navi wakes), and Navi Free's Gemini Nano sessions close after 3 minutes, so Chrome can unload the model.
- **Microphone setting:** choose which mic Navi listens with. A Bluetooth headset's own mic switches the headset into its low-quality call mode for all sound; listening with another mic keeps music and videos sounding normal.
- **Navi's window**, continued: the pill shows in Navi's window (pinned, or where the command runs), never in another window, and leaves the tab it was in. "New tab" and "reopen closed tab" open in Navi's window, not whichever window Chrome focused last.
  - New: "move this tab to a new window", "move this tab to the other window", "open YouTube in a new window" (and a move_tab tool for the AI).
  - Pinning understands "pen", "been" and other mishearings of "pin", and plain phrasings: "stay in this window", "work here", "follow me". The panel's toggle is now a "This window" chip next to Flags and Grid.
- **Helpers, revised.** Like subagents in Claude Code: the main AI starts them, checks on them (check_helpers) and stops them (stop_helper) when it wants, and each helper's report comes back to the main AI in the thread it was started from, which decides what to tell you (or waits quietly for the rest). One time limit (Settings, 15 minutes by default) instead of step and cost limits; a helper going in circles is told so after 3 repeats and stopped only after 8. Up to 5 at once. "Stop helper 2" by voice. The router sends "create a sub agent to …" to the AI instead of ignoring it.
- **First-run tutorial.** A two-minute spoken tour that moves on when you've done each step by voice: waking Navi, scrolling, clicking, searching, going back, interrupting, asking the AI, sleep and off. It works without looking or clicking ("next", "repeat", "end tutorial"), and asks one question first: whether Navi should say everything it does out loud, which sets that preference and tailors the tour (describing the screen instead of number tags). Navi offers it out loud the first time it's listening after setup; "start the tutorial", the setup page and Settings start it any time.
- **"Describe the screen"** ("what's on the screen", "what am I looking at"): the AI looks and describes the page for someone who can't see it; without an AI, Navi says what it can tell (the page, how many links, buttons and fields).
- **"Open settings"** by voice.
- Fixed: with no API key yet, choosing Pro in Settings and saving stored Pro's model settings under Free.
- Navi always answers the side panel, even if a command fails unexpectedly (a rare "message channel closed" error in tests).
- **Navi's window.** Each command now stays in the window it was given in: move to another window mid-task and Navi keeps working where it started, without taking focus. A command given while Navi works waits its turn, then runs in its own window.
  - **Pin Navi to a window** ("pin Navi to this window", or the panel's toggle): Navi then works only there, whichever window you're using, so you can work in one window while Navi works in another. "Unpin Navi" goes back to following you; closing the pinned window unpins it (Navi says so).
- **Threads.** Separate conversations, like a chat app: "new thread" (or "new thread about trip planning", or the + in the panel) starts one; "go back to the trip thread", "previous thread" or the thread menu switches; "list threads" and "rename this thread to …" too. Each thread keeps its own feed and its own AI conversation; one that has expired is recapped from its last exchanges. Threads and their feeds are kept in this browser profile (up to 20 threads).
  - One command runs at a time across threads. Starting or switching threads works mid-task: the task finishes in its own thread (the panel says "Working in …"), and a command given meanwhile waits its turn, then runs in the thread it was given in.
- **Memory.** Navi keeps one short note about you (up to 3,000 characters: who you are, your preferences, your projects) and reads it at the start of each conversation. A background job on the quick model (GPT-6 Luna, or Sonnet 5.5 with only a Claude key) updates it a minute after Navi goes quiet, or sooner after 10 exchanges. On by default in Pro, off in Free; see, edit or clear it in Settings, or just tell Navi to remember or forget something.
  - **Poisoning-safe:** the job only sees what you said and what Navi replied, never page text; it stores facts you gave, never instructions, and never passwords, payment, ID or health details. The AI reads the note as background facts, not commands.
  - Its cost shows in today's total and the usage log, but doesn't count as a command.
- **Free and Pro presets.** Each mode keeps its own model, reasoning, asking (YOLO), step limit, quick check, memory and helper-agent settings; switching modes restores them. Wake name, voice and privacy settings stay shared.
- NaviBench has a memory suite: 11 conversations, including page injections, card numbers, passwords, small talk and "forget that".

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
