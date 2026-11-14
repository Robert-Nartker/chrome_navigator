# Speech benchmark results (November 2026)

How well Navi understands spoken commands, measured on audio instead of guessed: what each recognizer writes down, and then **what Navi's own parser does with it**. Method and scripts: [bench/asr/README.md](../../bench/asr/README.md). Chrome's own recognizer can't run outside Chrome, so it isn't measured here; Parakeet and Whisper run exactly the models Navi uses (Parakeet TDT 0.6B v2; Whisper small), on the processor, int8.

**Why this exists:** with AirPods on a Windows desktop, single-word commands "didn't register 90% of the time" and multi-word ones were misunderstood about half the time, with both Chrome's recognizer and Parakeet.

## The short version

1. **The headset's mic is the main cause.** A Bluetooth headset records at phone-call quality (8–16 kHz, compressed). Through it, with a little room noise or a soft voice, Parakeet + Navi got **56–63% of commands** and **25–33% of single words** right (one voice), which matches the reported experience.
2. **Single words are the hardest, and short words come back empty.** Real people saying single words: Parakeet wrote nothing at all for 22% of them through a noisy headset, and "uh"/"um"/"oh" for many more. Now Navi plays its "didn't catch that" sound when that happens, instead of staying silent.
3. **Whisper small hears headsets better than Parakeet.** Real people's single words, exactly right: 78% vs 62% through a narrowband headset, 57% vs 38% with room noise, 86% vs 79% clean. It never comes back empty. Navi now offers it ("use Whisper"), and the headset warning suggests it.
4. **Navi's parser now recovers more of what's misheard** ("a play", "new tabs", "delete the lost word", "switch to top 3", "open youtuber"): +2 points overall, +4 to +9 points on single words.
5. **Not the cause:** Navi's speech detector found the phrase in 99–100% of clips in every condition, and turning the audio up first changed nothing.

## Commands (80 phrases, Kokoro voices)

"Correct": the command meant ran. "Right command, words off": the right kind of command with its free text slightly off (a search query, what to type). "Wrong command": a different built-in command ran (the dangerous case). "Not understood": no built-in command matched, so it goes to the AI router, which may still recover it.

All 28 voices, Parakeet, before and after tonight's parser changes:

| Audio | Correct (before → after) | Wrong command (after) | Not understood (after) | Single words correct (before → after) |
|---|---|---|---|---|
| Clean | 88% → **90%** | 1% | 6% | 76% → **80%** |
| Bluetooth narrowband (CVSD 8 kHz) | 83% → **85%** | 1% | 10% | 68% → **70%** |

One voice (af_bella), the harder conditions:

| Audio | Correct | Wrong command | Single words correct |
|---|---|---|---|
| Bluetooth wideband (mSBC 16 kHz) | 91% | 4% | 83% |
| Narrowband + room noise (10 dB) | 56% → 59% | 5% | 25% → 33% |
| Soft voice | 89% | 4% | 75% |
| Narrowband + soft voice | 63% | 8% | 33% |

## Real people, single words (Google Speech Commands, 520 recordings, 13 words)

Exactly the word said:

| Recognizer | Their mic | + Bluetooth narrowband | + narrowband and room noise |
|---|---|---|---|
| Parakeet TDT 0.6B v2 | 79% | 62% | 38% |
| **Whisper small (English)** | **86%** | **78%** | **57%** |
| Whisper base | 66% | 70% | 52% |
| Moonshine base | 66% | 26% | 17% |

Per word, through the narrowband headset: "stop" Parakeet 70% / Whisper small 90%; "up" 30% / 75%; "down" 60% / 85%; "off" 10% / 38%.

What came back instead: Parakeet, nothing at all (44 of 520 through the headset, 112 with noise) or fillers ("uh", "um", "oh", "yeah"). Whisper small: short wrong words ("oh", "of"), occasionally a sound label ("[BLANK_AUDIO]", "static"), which Navi now strips. Whisper base sometimes loops a word ("stop stop stop …"), so Navi uses small.

## Things tried that didn't help (enough)

- **Turning the audio up before recognition:** no change (80% → 82%, noise 63% → 64%). Both models normalize their input.
- **Contextual biasing (hotwords) for Parakeet:** noisy narrowband 56% → 68% correct, single words 25% → 50%, but wrong commands 8% → 13%, since it pulls noise toward command words. Promising with tuning, but it needs beam-search decoding Navi's Parakeet doesn't have yet.
- **Giving Whisper the commands as a prompt** (as earlier context, the way Whisper's "initial prompt" works; `whisper_prompt.py`): real people's single words through a noisy headset, exactly right 57% → 68%, but words turned into a *different* command 4% → 11% ("off" heard as "up" 11 times of 40, "follow" and "on" as "pause"). Not shipped: a wrong command is worse than a missed one.
- **Padding the audio with silence** before Parakeet (noisy headset, real people's single words): 0.5 s each side 63% → 66% understood, nothing heard 22% → 19%; 1.5 s each side much worse (40%, 54% nothing). More conditions running; see below.
- **A keyword spotter built for commands** (3.3M parameters): 84–88% on clean or narrowband audio, but 36% with noise, and it fired on 7–13% of other phrases.

## What a user can do

- **Another mic beats any software fix:** a webcam's mic, any wired or USB mic. Navi now notices a Bluetooth headset mic by its name and says so.
- **Windows 11 uses wideband speech (mSBC, 16 kHz) for AirPods when the hardware supports it** ([Microsoft: Bluetooth classic audio](https://learn.microsoft.com/windows-hardware/drivers/bluetooth/bluetooth-classic-audio); [AirPods wideband support](https://www.howtogeek.com/778575/windows-11-is-getting-better-support-for-airpods/)). That's the better of the two headset conditions above.
- **Say commands in a few words** ("pause the video", "close this tab"): multi-word commands survive headset audio far better than single words.
