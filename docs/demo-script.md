# Demo script

A 3–4 minute run through what Navi does best, with a fallback for every step. Rehearse it once, start to finish, an hour before.

## Before the demo

- **Freeze the version.** Once a rehearsal goes well, stop `npm run dev` (Ctrl+C). Navi keeps running the build it has; the panel footer just says "dev server offline". Nothing new can land mid-demo. (To keep auto-rebuilds but no new commits: `npm run dev -- --no-pull`.)
- **Microphone.** In a quiet room, the laptop's own mic often hears better than AirPods (AirPods drop to a low-quality "headset" mic while they're recording). Try both in the rehearsal: Settings → Listening → Microphone.
- **Pro AI on** (your OpenAI key in Settings) for the AI steps. Without it, everything but step 6 still works.
- **Clean Chrome.** One window, a couple of tabs, logged in to YouTube. Close anything you don't want on screen.
- **Know the escape hatches:** Ctrl+Space (Control+Space on a Mac) always works, even if the wake word doesn't catch: press it, talk, press it again; "stop" interrupts anything; you can type in the side panel's chat box.

## The run

1. **Wake it.** "Hey Navi." *(It answers with a short sound; the page caption shows what it hears.)* Fallback: say it again, or press Ctrl+Space.
2. **Move around.** "Open YouTube." → "Search YouTube for lofi beats." → "Scroll down." → "Scroll up."
3. **Click by number.** "Show numbers." → "Click 4" (whichever video). → "Pause." → "Play." → "Go back."
4. **Tabs.** "Open Wikipedia." *(new tab)* → "Next tab." → "Close tab."
5. **For people who can't see the screen.** On an article: "List the headings." → "Go to the history section." → "Read this section." → "Stop."
6. **The AI does a task.** On a shopping or news page: "What's this page about?" Then something with steps: "Find me a standing desk under 400 dollars on Amazon." *(The panel shows each step; Navi says when it's done.)*
7. **Done.** "Go to sleep." *(Navi stops listening until "Hey Navi" again.)*

If a command is misheard, just say it again: one retry is normal. "What did you hear?" shows exactly what the recognizer wrote down.

## Lines that explain it

- "Everything you say is recognized on this computer; nothing is recorded or sent until you say its name."
- "Simple commands run instantly with no AI; only real tasks go to the AI, and it sees button names, not your page."
- "It's built for people who can't use a mouse or see the screen, and it's faster for everyone else."
