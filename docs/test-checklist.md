# Test checklist (real Chrome)

What the automated tests can't show: Chrome's real recognizer, your mic and voice, real sites. About 20 minutes. Use Navi the way you normally would, with these along the way.

**Before you start:** `npm run dev` running (it picks up the latest version by itself). When Navi gets something wrong, say **"that's not what I said"** right away: it marks the mistake in the log. **"What did you hear?"** tells you exactly what Chrome wrote down.

## Listening (most important)

- [ ] "Hey Navi" wakes it, a few times, at normal speed and casually. Also "wake up" and the Ctrl+Space key.
- [ ] Short commands, said naturally: "scroll down", "scroll up", "go back", "close tab", "new tab", "next tab", "pause". Does each run the right thing? How long after you stop talking?
- [ ] Numbers: "click 5", "type 8 thousand".
- [ ] Talk over Navi while it's speaking: "stop", and a command like "go to sleep".
- [ ] A few minutes with other people talking or a video playing: does Navi act on things you didn't say to it?
- [ ] AirPods: does your audio sound worse while Navi listens? If so, try Settings → Listening → Microphone → your computer's mic.

## New this week

- [ ] Dictation: click into a text box (or say "next field"), say "type Dear Sarah, thanks!", then "type see you soon". Expect "Dear Sarah, thanks! see you soon". Then "delete that" and "delete the last word".
- [ ] On a news or shopping page: "list the headings", "next heading", "go to the reviews section", "read this section", "next field", "next link", "go to main content".
- [ ] A menu that opens on hover (Amazon's "Account & Lists"): "hover over account".
- [ ] Ask the AI for a helper, then while it works: "also check Best Buy".

## Afterwards

Settings → **Usage log** → **Export CSV**, and send the file. It has, for each spoken command, what Chrome heard, its other guesses, whether Chrome hesitated, and the timings, so the next round of fixes can come from your real use. Nothing said while Navi was asleep is in it.

Tell me, too: the three things that annoyed you most, and anything that felt slow.
