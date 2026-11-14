# Demo video

Makes a 2-minute demo of Navi: the real extension in Chromium on three demo pages (a video site, an encyclopedia article, a desk shop), with Navi's panel beside the page, a caption for each command, and three Kokoro voices: a narrator, the user saying each command, and Navi answering in its own default voice (af_heart).

What's real and what's stood in for:

- **Real:** Navi as it ships. Its parser, flags, clicking, scrolling, page structure, reading, the panel and the page caption.
- **Stood in for:** the microphone (each command goes in through Navi's voice path with the recognizer replaced, and the user's voice is added from Kokoro), and the AI's replies in the shop scene (scripted, since recording runs without an API key; Navi still does the clicking).

## Making it

Needs `ffmpeg`, Python with `sherpa-onnx soundfile numpy scipy`, and Kokoro v1.0 for sherpa-onnx (`kokoro-multi-lang-v1_0` from the sherpa-onnx `tts-models` release).

```bash
OUT=/path/to/out; KOKORO=/path/to/kokoro-multi-lang-v1_0
npm run build
# A stand-in for the video on the video page (any 60-second MP4 works)
ffmpeg -f lavfi -i "gradients=s=1280x720:speed=0.004:d=60" -f lavfi -i "sine=frequency=220:duration=60" -c:v libx264 -c:a aac -t 60 $OUT/lofi.mp4
python3 scripts/demo-video/narrate.py lines scripts/demo-video/script.json $KOKORO $OUT/speech
DEMO_OUT=$OUT npx playwright test -c scripts/demo-video
python3 scripts/demo-video/narrate.py replies scripts/demo-video/script.json $KOKORO $OUT/speech $OUT/events.json
python3 scripts/demo-video/compose.py scripts/demo-video/script.json $OUT     # writes $OUT/navi-demo.mp4
```

Change what's said and done in `script.json`. Timing follows the speech: the recording waits for each line to be said, and the voices are laid in at the moments the recording logged.
