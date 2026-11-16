# Demo video

Makes a short demo of Navi (about 80 seconds), recorded in a real Chromium window: tabs, address bar and Navi in Chrome's own side panel, dark mode, on real sites (Wikipedia, Hacker News). No narrator: short text cards say what each part shows. Two voices, labelled on screen: the user saying each command (OpenAI's `gpt-4o-mini-tts`, voice "ash") and Navi in its own default voice (Kokoro `af_heart`). Navi runs as in everyday use with its panel open: actions get its short chime, and only answers are spoken. The AI's thinking time is sped up 6x (with a badge), and the title, recording and end card are joined with crossfades.

What's real and what's stood in for:

- **Real:** Navi as it ships, in a real browser window on live sites: listening (the words show in Navi's live caption as they're said, and the phrase ends as with a mic), parsing, the router, flags, clicking, page structure, reading, the panel, and the AI (it runs through OpenAI for real, so its answers change from run to run).
- **Stood in for:** the speech recognizer (each command goes in as words through Navi's on-device recognizer interface, and the user's voice is added afterwards), Navi's voice and chimes (the recording has no sound; what Navi said and played is noted as it happens, then laid in, Navi's speech in Kokoro and cut when the next command starts, as talking over Navi does), and Wikipedia's fundraising banner (hidden). "Click <n>" uses the number Navi's flag shows on the link, read off the page during the recording.

## Making it

Needs `ffmpeg`, `Xvfb` (`xvfb-run`), Python with `sherpa-onnx soundfile numpy`, Kokoro v1.0 for sherpa-onnx (`kokoro-multi-lang-v1_0` from the sherpa-onnx `tts-models` release), network access to the sites, and an OpenAI key for the AI and the user's voice (`OPENAI_API_KEY`; this sandbox's proxy adds it; for the recording, put a real key in `record.ts`'s settings).

```bash
OUT=/path/to/out; KOKORO=/path/to/kokoro-multi-lang-v1_0
npm run build
python3 scripts/demo-video/narrate.py lines scripts/demo-video/script.json $KOKORO $OUT/speech
DEMO_OUT=$OUT xvfb-run -a -s "-screen 0 1920x1080x24" npx tsx scripts/demo-video/record.ts
python3 scripts/demo-video/narrate.py replies scripts/demo-video/script.json $KOKORO $OUT/speech $OUT/events.json
python3 scripts/demo-video/compose.py scripts/demo-video/script.json $OUT     # writes $OUT/navi-demo.mp4
```

Change what's said and done in `script.json`. Timing follows the speech: the recording waits for each line to be said and for Navi to answer, and the voices are laid in at the moments the recording logged.

How the recording reaches Navi: Playwright doesn't attach to an extension's offscreen page or side panel in a visible browser, so `record.ts` opens the side panel with a real click (Chrome requires one), then talks to both pages over Chrome's debugging protocol: it installs the stand-in recognizer in the offscreen page and reloads it (Navi restarts listening in a reloaded one), and reads Navi's replies from the panel.
