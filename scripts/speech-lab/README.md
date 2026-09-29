# Speech lab

Tests open-weight voices (text-to-speech) and speech recognizers that could run inside Navi for free, on Navi's
own replies and commands. Everything runs locally on the CPU through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx);
nothing is sent anywhere.

```bash
pip install sherpa-onnx numpy soundfile
./fetch.sh                  # model builds from sherpa-onnx's GitHub releases (~6 GB) and noise recordings
python3 voices.py           # MP3 samples of three Navi replies per voice, and speed, in out/voices/
python3 asr.py build        # every test phrase spoken by one of 33 synthetic voices: quiet, café chatter, loud noise
python3 asr.py decode       # each recognizer transcribes the set; results in out/asr/
```

**The test set:** Navi's router and agent benchmark phrases (`bench/`), plus 30 built-in commands such as "click
twelve" and "hey navi scroll down": 116 phrases. Each is spoken by a different synthetic voice (Kokoro, Supertonic,
Kitten, Pocket TTS, Piper), then mixed with café chatter 10 dB below the voice, and with other noise (vacuum,
typing, air conditioner, a neighbor) 5 dB below, from Microsoft's MS-SNSD recordings.

**Caveats:**
- Synthetic speech is cleaner than a person in a real room, so compare models with each other; don't read the
  word error rates as what you'd get in use.
- Speeds are on one CPU thread, which is what a browser tab gets without cross-origin isolation. Browser
  WebAssembly is roughly 1.5 to 3 times slower than this; WebGPU is much faster where there's a graphics chip.
- Chrome's own on-device recognizer (what Navi uses) isn't in open-source Chromium, so it can't be tested here.

## Results (2026-09-29, 4 vCPU cloud VM, no GPU)

**Voices** (speed: seconds of work per second of speech, one thread; misheard: Parakeet v3's word errors on the voice's test phrases):

| Voice | Speed | First sentence | Misheard | Size |
|---|---|---|---|---|
| Kokoro v1.0 | 1.14× | 1.6 s | 1.2% (48 phrases) | 369 MB |
| Pocket TTS | 0.78× | 1.2 s | 24.4% (6 phrases) | 203 MB |
| Supertonic 3 | 0.33× | 0.8 s | 2.9% (35 phrases) | 145 MB |
| Kitten mini 0.1 | 1.65× | 4.2 s | – | 166 MB |
| Kitten nano 0.2 | 0.38× | 0.9 s | 6.9% (24 phrases) | 24 MB |
| Piper lessac | 0.12× | 0.1 s | 7.1% (3 phrases) | 63 MB |

**Recognizers** (word error rate; per command: median on one thread):

| Recognizer | Maker | Quiet | Café chatter | Loud noise | Word-perfect, quiet | Per command | Size |
|---|---|---|---|---|---|---|---|
| Qwen3-ASR 1.7B (4-bit build) | Alibaba Qwen (China) | 5.4% | 7.7% | 7.5% | 88% | 2.08 s | 1468 MB |
| Whisper small.en | OpenAI (US) | 6.1% | 7.0% | 10.2% | 81% | 1.52 s | 376 MB |
| Qwen3-ASR 0.6B | Alibaba Qwen (China) | 6.1% | 8.2% | 10.9% | 85% | 1.53 s | 987 MB |
| Parakeet TDT 0.6B v3 | NVIDIA (US) | 4.6% | 8.8% | 15.3% | 89% | 0.41 s | 670 MB |
| Nemotron streaming 0.6B | NVIDIA (US) | 8.4% | 10.2% | 11.2% | 77% | 1.28 s | 662 MB |
| Parakeet TDT 0.6B v2 | NVIDIA (US) | 7.5% | 8.1% | 16.1% | 81% | 0.43 s | 661 MB |
| Distil-Whisper large-v3.5 | Hugging Face (US) | 9.6% | 11.1% | 12.6% | 78% | 4.53 s | 984 MB |
| Whisper large-v3-turbo | OpenAI (US) | 7.9% | 13.3% | 13.7% | 82% | 4.38 s | 1037 MB |
| Moonshine base (v2) | Moonshine AI (US) | 11.4% | 17.7% | 33.2% | 78% | 0.10 s | 141 MB |
| Canary 180M flash | NVIDIA (US) | 17.7% | 22.8% | 25.8% | 70% | 0.40 s | 207 MB |
| Moonshine tiny (v2) | Moonshine AI (US) | 11.8% | 19.5% | 40.9% | 71% | 0.05 s | 44 MB |

Qwen3-ASR 1.7B has no sherpa-onnx build, so it ran through [HaujetZhao/Qwen3-ASR-GGUF](https://github.com/HaujetZhao/Qwen3-ASR-GGUF)
(the `Qwen3-ASR-1.7B-gguf.zip` release: int4 encoder, q4_k decoder) on llama.cpp b11247, with that project's ctypes structs
updated to match b11247's `llama.h`. Being a 4-bit build, it may score a little worse than the official weights.

Pocket TTS, Supertonic, Kitten and Piper were judged not good enough to ship and were removed from Navi. Kokoro's samples
read numbers the way Navi's Kokoro (kokoro-js) does, e.g. "$129" as "129 dollars".
