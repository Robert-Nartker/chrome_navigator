# Overnight work, 2026-11-14

What I did while you were away, what I found, and what needs you. Everything is on `claude/sleepy-hypatia-gt7x80` (your `npm run dev` follows it); `main` is untouched until you've tried it.

## What needs you (in this order)

1. **Try Whisper with your AirPods.** Say "use Whisper" (or Settings → Listening → Recognizer). It downloads once (about 1 GB), then says "Whisper is ready." Try the single words that failed before ("pause", "stop", "play", "mute") and a few multi-word ones. This is the change most likely to fix what you hit; it couldn't be tried in a real browser here (Hugging Face, where the model lives, is blocked from this sandbox).
2. **Try the laptop mic** with whichever recognizer is better on it.
3. **Send the usage log** (Settings → Export usage log CSV) after a session: it now records which recognizer heard each command, which is the real-world version of tonight's benchmark.
4. **Watch the demo video draft** (sent earlier as `navi-demo-draft1.mp4`) and say what to change.

## The speech problem: measured, not guessed

Full results: [research/asr-benchmark.md](research/asr-benchmark.md). Method and scripts: [bench/asr](../bench/asr/README.md). In short:

- **The headset's mic is the main cause.** Bluetooth headsets record at phone-call quality. Through that, with a bit of room noise, Parakeet + Navi got about 60% of commands and 25–40% of single words right, which is what you saw. Navi's speech detector isn't the problem (it catches 99–100% of phrases).
- **Whisper small hears headset audio better than Parakeet.** Real people's single words, exactly right: 78% vs 62% through narrowband Bluetooth, 57% vs 38% with room noise. It never returns nothing, where Parakeet returned nothing for 22% of noisy single words. Navi now offers Whisper as a third recognizer.
- **When a model hears speech but no words**, Navi now plays its short "didn't catch that" sound instead of staying silent.
- **The parser recovers more mishearings** (from the benchmark's misses): +2 points overall, more on single words, no more wrong commands, and checked against chatter so talk nearby stays talk.
- **Tried and not shipped:**
  - **Giving Whisper the command list as a prompt:** noisy single words 57% → 68%, but wrong commands 4% → 11% ("off" heard as "up", others as "pause"). A wrong command is worse than a missed one, so no.
  - **Hotword biasing for Parakeet:** the same trade-off.
  - **A tiny keyword spotter:** fails in noise.
  - **Turning the audio up:** no effect.

## Everything tested by voice

A new browser test says every built-in command the AI router knows about, on real pages, and fails on any error or hang. It also prints each command's time: a median of 33 ms on the fast path (no AI), most of the rest being the time to say the reply. It found four real bugs, all fixed:

- **"Find next" searched for the word "next".**
- **"Slow down" slowed Navi's voice while a sped-up video played.** Now it slows a video that's playing or sped up, and Navi's voice otherwise.
- **Replies piled up.** After a few thread or window commands, the next answer came 5–6 seconds late; now a new command cuts off what Navi was still saying.
- **A video that couldn't play showed the browser's raw error.** Now it's plain words, and a video Chrome won't start with sound plays without sound instead (with a note why).

Also fixed:

- **Settings:** switching Free/Pro could undo a choice made right after it.
- **A key saved a moment ago** is used by the very next command.
- **The power button no longer disappears while listening.**

A review of tonight's own code caught "open canva" opening Canvas, chatter cutting Navi off mid-sentence, and "oh back" said nearby going back. All three are fixed.

## Commits tonight

See `git log` on the branch; CHANGELOG.md (2026-11-14) lists every user-visible change.
