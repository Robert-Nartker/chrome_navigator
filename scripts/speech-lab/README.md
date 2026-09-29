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
