# Speech benchmark

Measures what matters for Navi: **does the command you meant run**, when you say it through a real mic. The same audio goes through several on-device recognizers, then through Navi's own parser (`src/lib/parser.ts`), so a mishearing Navi already understands counts as right, and one that runs a different command counts as wrong.

Everything runs offline on the processor with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0). Models, voices and data live outside the repo (default `/home/user/navi-asr`). Chrome's own recognizer can't run outside Chrome, so it isn't in the numbers.

## Pieces

| Script | Does |
|---|---|
| `phrases.txt` | 80 things people say to Navi: single words, short commands, longer requests (and five for the AI) |
| `expect.mjs` | Navi's parser on each phrase: the command each should run |
| `synth.py` | Says every phrase in Kokoro's 28 English voices (American and British, women and men) at speeds from 0.9× to 1.2× |
| `humanset.py` | 520 recordings of real people saying single words ("stop", "up", "down", "go", …) from Google Speech Commands (CC BY 4.0) |
| `degrade.py` | What a headset does to the audio: Bluetooth wideband (mSBC), narrowband (CVSD, 8 kHz, what Windows often uses with AirPods), narrowband with room noise, a soft voice |
| `transcribe.py` | Runs Parakeet TDT 0.6B v2 (what Navi uses), Whisper tiny/base/small, or Moonshine on a folder of clips; optional hotword biasing |
| `vadsim.py` | Navi's speech detector (Silero VAD + `src/voice/phrases.ts`): does a command become a phrase at all? |
| `kws.py` | A 3.3M-parameter keyword spotter, for comparison |
| `score.mjs` | Scores transcripts with Navi's parser: correct, wrong command, not understood, heard nothing, word error rate |

## Running it

```bash
python3 -m pip install sherpa-onnx soundfile numpy scipy onnxruntime sentencepiece
# Models: sherpa-onnx GitHub releases (asr-models, tts-models, kws-models); data: Google Speech Commands v0.02
npx esbuild src/lib/parser.ts --bundle --platform=node --format=esm --outfile=$D/parser.mjs
node bench/asr/expect.mjs $D/parser.mjs bench/asr/phrases.txt > $D/phrases.json
python3 bench/asr/synth.py $D/phrases.json $D/models $D/clean
python3 bench/asr/degrade.py $D/clean $D/deg $D/data/speech_commands/_background_noise_
python3 bench/asr/transcribe.py parakeet $D/models $D/deg/cvsd $D/parakeet-cvsd.json
node bench/asr/score.mjs $D/parser.mjs $D/phrases.json $D/parakeet-*.json --misses $D/misses.json
```

Results and what came of them: [docs/research/asr-benchmark.md](../../docs/research/asr-benchmark.md).
