# Demo video

Makes a demo of Navi of under 2 minutes, recorded in a real Chromium window: tabs, address bar and Navi in Chrome's own side panel, dark mode, on real sites (Wikipedia, Hacker News). Three Kokoro voices: a narrator (`bm_george`), the user saying each command (`am_michael`), and Navi answering in its own default voice (`af_heart`). The narrator and the user are labelled on screen; Navi's words show in its panel and its caption on the page.

What's real and what's stood in for:

- **Real:** Navi as it ships, in a real browser window on live sites: listening (the words show in Navi's live caption as they're said, and the phrase ends as with a mic), parsing, the router, flags, clicking, page structure, reading, the panel, and the AI (it runs through OpenAI for real, so its answers change from run to run).
- **Stood in for:** the speech recognizer (each command goes in as words through Navi's on-device recognizer interface, and the user's voice is added from Kokoro), Navi's voice (the recording has no sound; its replies are said afterwards in Kokoro, at the moment each appeared, and cut when the next command starts, as talking over Navi does), and Wikipedia's fundraising banner (hidden).

## Making it

Needs `ffmpeg`, `Xvfb` (`xvfb-run`), Python with `sherpa-onnx soundfile numpy`, Kokoro v1.0 for sherpa-onnx (`kokoro-multi-lang-v1_0` from the sherpa-onnx `tts-models` release), network access to the sites, and an OpenAI key (this sandbox's proxy adds it; elsewhere put a real key in `record.ts`'s settings).

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
