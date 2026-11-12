# Demo script

A 3–4 minute run through what Navi does best, with a fallback for every step. Rehearse it once, start to finish, an hour before.

## Before the demo

- **Freeze the version.** Once a rehearsal goes well, stop `npm run dev` (Ctrl+C). Navi keeps running the build it has; the panel footer just says "dev server offline". Nothing new can land mid-demo. (To keep auto-rebuilds but no new commits: `npm run dev -- --no-pull`.)
- **Microphone.** In a quiet room, the laptop's own mic often hears better than AirPods (AirPods drop to a low-quality "headset" mic while they're recording). Try both in the rehearsal: Settings → Listening → Microphone.
- **Pro AI on** (your OpenAI key in Settings) for the AI steps. Without it, everything but step 6 still works.
- **Clean Chrome.** One window, a couple of tabs, logged in to YouTube. Close anything you don't want on screen.
- **Turn Navi on** with the switch in its panel before you start, and click **Stay awake** so it doesn't fall asleep while you explain something.
- **Know the escape hatches:** Ctrl+Space (Control+Space on a Mac) always takes one command, even if Navi is asleep; "stop" interrupts anything; you can type in the side panel's chat box. Multi-word commands ("pause the video", "close this tab") are heard more reliably than single words.

## The run

1. **Turn it on.** Click the switch (or, with Navi asleep, say "wake up"). *(A short sound; the page caption shows what it hears.)* Fallback: press Ctrl+Space and say the command.
2. **Move around.** "Open YouTube." → "Search YouTube for lofi beats." → "Scroll down." → "Scroll up."
3. **Click by number.** "Show numbers." → "Click 4" (whichever video). → "Pause the video." → "Play the video." → "Go back."
4. **Tabs.** "Open Wikipedia." *(new tab)* → "Next tab." → "Close tab."
5. **For people who can't see the screen.** On an article: "List the headings." → "Go to the history section." → "Read this section." → "Stop."
6. **The AI does a task.** On a shopping or news page: "What's this page about?" Then something with steps: "Find me a standing desk under 400 dollars on Amazon." *(The panel shows each step; Navi says when it's done.)*
7. **Done.** "Go to sleep." *(Navi waits for "wake up".)* "Turn off" closes the mic completely.

If a command is misheard, just say it again: one retry is normal. "What did you hear?" shows exactly what the recognizer wrote down.

## Lines that explain it

- "Everything you say is recognized on this computer, and when Navi's off, the mic is closed and nothing's loaded."
- "Simple commands run instantly with no AI; only real tasks go to the AI, and it sees button names, not your page."
- "It's built for people who can't use a mouse or see the screen, and it's faster for everyone else."
