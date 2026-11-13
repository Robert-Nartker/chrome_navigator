# Test checklist (real Chrome)

What the automated tests can't show: Chrome's real recognizer, your mic and voice, real sites. About 20 minutes. Use Navi the way you normally would, with these along the way.

**Before you start:** `npm run dev` running (it picks up the latest version by itself). When Navi gets something wrong, say **"that's not what I said"** right away: it marks the mistake in the log. **"What did you hear?"** tells you exactly what Chrome wrote down.

## Listening (most important)

- [ ] Chrome opens with Navi **off**. The power button in the panel turns it on, awake. After two quiet minutes it falls asleep; "wake up" wakes it. "Stay awake" keeps it awake.
- [ ] Ctrl+Space (push to talk) takes one command while Navi is asleep, and while it's off.
- [ ] Short commands, said naturally: "scroll down", "scroll up", "go back", "close tab", "new tab", "next tab", "pause". Does each run the right thing? How long after you stop talking?
- [ ] Numbers: "click 5", "type 8 thousand".
- [ ] Talk over Navi while it's speaking: "stop", and a command like "go to sleep".
- [ ] A few minutes with other people talking or a video playing: does Navi act on things you didn't say to it?
- [ ] AirPods: does your audio sound worse while Navi listens? If so, try Settings → Listening → Microphone → your computer's mic.

## Chrome's recognizer vs Parakeet

Do the listening checks above twice, once with each, in the same place with the same mic (your AirPods), so the only difference is the recognizer.

1. **Chrome's first** (the default). Say "which recognizer are you using?" to be sure.
2. **Then say "use Parakeet"** (or Settings → Listening → Recognizer → Parakeet). The first time it downloads once (about 2.5 GB with a graphics chip, 0.7 GB without); Chrome's recognizer keeps listening meanwhile, and Navi says "Parakeet is ready." The panel's voice card then says "Hears: Parakeet".
3. **Repeat the same checks.** Expect its live caption to update in jumps (about once a second) rather than word by word; what matters is whether the command that runs is right, and how soon after you stop.
4. **Watch the computer:** Chrome's task manager (Shift+Esc on Windows; ⋮ → More tools → Task manager on a Mac) shows Navi's memory as "Extension: Navi". Fans or a hot laptop are worth telling me about.
5. **Back any time:** "use Chrome's recognizer".

Compare: which got commands right first time more often, which felt faster, which woke more reliably on "Hey Navi", and which acted on talk not meant for it. The usage log records which recognizer heard each command, so one CSV covers both.

## New this week

- [ ] Dictation: click into a text box (or say "next field"), say "type Dear Sarah, thanks!", then "type see you soon". Expect "Dear Sarah, thanks! see you soon". Then "delete that" and "delete the last word".
- [ ] On a news or shopping page: "list the headings", "next heading", "go to the reviews section", "read this section", "next field", "next link", "go to main content".
- [ ] A menu that opens on hover (Amazon's "Account & Lists"): "hover over account".
- [ ] Ask the AI for a helper, then while it works: "also check Best Buy".
- [ ] A helper that has to choose ("have a helper find me a standing desk under $400 and put the best one in the cart"): if it asks, you hear a ding and see a card; "what does the helper want?", then "option 1" or "tell the helper …". Keep talking to Navi meanwhile: the helper should never talk over you.

## Afterwards

Settings → **Usage log** → **Export CSV**, and send the file. It has, for each spoken command, what Chrome heard, its other guesses, whether Chrome hesitated, and the timings, so the next round of fixes can come from your real use. Nothing said while Navi was asleep is in it.

Tell me, too: the three things that annoyed you most, and anything that felt slow.
