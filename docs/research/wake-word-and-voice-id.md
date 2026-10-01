# Wake word, voice ID, and always-on listening in a Chrome extension (researched 2026-09-24)

**How reliable these findings are.** The research sandbox blocked developer.chrome.com, picovoice.ai and MDN. Claims were checked instead against Chromium source at each release tag (GitHub mirror), npm tarballs, GitHub READMEs, W3C spec sources, and Google's extension samples. Picovoice pricing comes from search snippets only. Items marked UNVERIFIED could not be confirmed.

## What this means for Navi

1. **The side panel can run speech recognition.** Chromium has allowed Web Speech in side panels since Chrome 120. (Navi has since moved recognition to an offscreen document, so it keeps listening with the panel closed.)
2. **The mic prompt can't appear in a side panel or offscreen document.** Permission has to be granted once from a normal extension tab (`setup.html`). Navi does this.
3. **On-device recognition exists and needs opting in.**

   | Feature | Chrome version |
   |---|---|
   | `processLocally`, `available()`, `install()` | 139 |
   | Phrase boosting (`phrases`, boost 0–10) | 142 |
   | `start(MediaStreamTrack)` | 135 |

   - `processLocally` defaults to false.
   - Setting `phrases` without `processLocally` raises `phrases-not-supported`.
   - `install()` needs a user click, so Navi's setup page has a "Download on-device speech" button.
   - With on-device mode, listening for "Hey Navi" is private without a separate wake-word engine.
4. **Keep listening with the panel closed (done: Navi works this way now).**
   - Move audio into an **offscreen document** (reasons `USER_MEDIA` + `AUDIO_PLAYBACK`).
   - `USER_MEDIA` has no lifetime limit in Chromium's lifetime enforcer.
   - Web Speech works in offscreen documents only from **Chrome 150**.
   - Offscreen documents can only use `chrome.runtime`, so command execution would move to the service worker.

## Dedicated wake-word engine (optional; lower CPU, more robust)

**Picovoice Porcupine** (`@picovoice/porcupine-web` 4.0.1, plus `@picovoice/web-voice-processor` 4.0.10):
- **Custom wake word:** "Hey Navi" is trained in Picovoice Console; download the "Web (WASM)" `.ppn` file.
- **Built-ins:** "Jarvis", "Computer" and others work without training.
- **Free plan** (search snippets): personal and non-commercial use only, 1 monthly active user. An AccessKey is required and gets validated online. The key ships inside the extension.
- **Chrome Web Store risk:** Porcupine's worker and worklet load from `blob:` URLs, which a Web Store reviewer said violates MV3 policy. Use the main-thread `Porcupine` class with a packaged AudioWorklet instead.

```ts
import { Porcupine } from "@picovoice/porcupine-web";
const ppn = await Porcupine.create(ACCESS_KEY,
  [{ publicPath: "models/hey_navi_wasm.ppn", label: "hey_navi", sensitivity: 0.6 }],
  (d) => onWake(d.label), { publicPath: "models/porcupine_params.pv" });
await ppn.process(int16Frame); // ppn.frameLength samples at ppn.sampleRate
```

**Open-source alternative: openWakeWord.**
- Licenses: code is Apache-2.0; pre-trained models are CC BY-NC-SA.
- A custom model can be trained in about an hour in Colab from synthetic speech.
- There is no official browser build; porting it to onnxruntime-web would take roughly 2–4 days.

## Voice enrollment / speaker verification ("only act on my voice")

**Picovoice Eagle** (`@picovoice/eagle-web` 3.0.1):
- Setup: `EagleProfiler.enroll(frame)` reports percent progress. When it reaches 100, `export()` saves the profile.
- At runtime, `Eagle.process(pcm, profile)` returns a score from 0 to 1.
- Free-plan access is UNVERIFIED.

**Open-source option:** WeSpeaker ONNX models (ECAPA / CAM++, CC BY 4.0) running on onnxruntime-web. You'd need to compute filterbank features in JS, score with cosine similarity, and tune a threshold: about 3–5 days.

**Design note:** speaker verification filters out *other people* (TV, roommates, someone on a call). It does not tell apart *your* commands from *your* conversation. The session model handles that part: say the wake word once, commands flow, then it sleeps after a quiet timeout or "go to sleep". Voice ID is a good add-on for the awake session, not a replacement for the wake word.

**Voice activity detection:** `@ricky0123/vad-web` 0.0.31 (Silero v5, onnxruntime-web). Bundle the worklet, ONNX model and wasm files locally; with local files it's MV3-safe.

## Avoiding self-triggering

- Capture with `echoCancellation: true`, but also run half-duplex: ignore recognition while Navi is speaking, then resume 300–700 ms later. (Navi now does something better: you can talk over it, and words that match what Navi is saying are ignored as echo.)
- "Stop" still interrupts a long read-aloud.
- Voice ID would additionally reject Navi's own voice.

## Sources

- npm: `@picovoice/porcupine-web`, `@picovoice/eagle-web`, `@picovoice/web-voice-processor`, `@ricky0123/vad-web`, `onnxruntime-web`
- https://github.com/Picovoice/porcupine, https://github.com/Picovoice/eagle
- https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.offscreen-user-media
- https://github.com/PostHog/posthog-js/issues/1464 (Web Store reviewer on blob workers)
- Chromium: `extensions/browser/api/offscreen/lifetime_enforcer_factories.cc`, `chrome/browser/speech/chrome_speech_recognition_manager_delegate.cc`, `third_party/blink/renderer/modules/speech/speech_recognition.idl`, `runtime_enabled_features.json5`
- https://github.com/WebAudio/web-speech-api
- https://github.com/dscripka/openWakeWord, https://github.com/wenet-e2e/wespeaker
