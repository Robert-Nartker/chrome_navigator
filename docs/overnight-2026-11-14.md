# Overnight work, 2026-11-14

What I did while you were away, what I found, and what needs you. Newest notes at the bottom of each section.

## The speech problem: measured, not guessed

Until now the only evidence was "it feels bad". Tonight Navi got a speech benchmark (`bench/asr/`, see its README) that runs the same audio through the recognizers and then through **Navi's own parser**, so the score is "did the command you meant run", not just word accuracy.

- **Audio:** 80 phrases people say to Navi (single words, short commands, longer requests), each said by 28 synthetic voices (Kokoro, American and British, women and men, at varied speeds), plus **520 recordings of real people** saying single words (Google Speech Commands: "stop", "up", "down", "go", "on", "off", …).
- **What a headset does to it:** clean; Bluetooth wideband (mSBC, 16 kHz); Bluetooth narrowband (CVSD, 8 kHz, what Windows often uses with AirPods); narrowband with room noise; a soft voice; a soft voice through narrowband.
- **Recognizers:** Parakeet TDT 0.6B v2 (what Navi uses), Whisper tiny/base/small, Moonshine tiny/base, all on the processor. Chrome's own recognizer can't run outside Chrome, so it isn't in the numbers.

### First results (one voice, then real people)

- Parakeet + Navi's parser, synthetic voice: 94% of commands right on clean audio, 89% through narrowband Bluetooth, but **56% with room noise and 63% with a soft voice through narrowband; single words 25–33%**. That matches your experience almost exactly.
- **Real people, single words:** Parakeet gets 23% of single words wrong even on their ordinary mics, 46% through narrowband Bluetooth, 72% with room noise. With noise, **22% come out as nothing at all** and many more as "uh", "um", "oh". That is the "single words don't register" you hit.
- **Not the cause:** Navi's speech detector (the part that decides a phrase happened) found the phrase in 99–100% of clips in every condition, and turning the audio up before recognition changed nothing.
- **Partly helps:** telling Parakeet which phrases to expect (contextual biasing) raised noisy-narrowband accuracy from 56% to 68% and single words from 25% to 50%, but also raised wrong commands from 8% to 13%.
- A tiny keyword spotter built for commands fails the same way under noise (36% caught).
