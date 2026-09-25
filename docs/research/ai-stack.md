# Navi AI stack: models, live voice, TTS, STT (researched 2026-09-25)

**How reliable these numbers are.** The research sandbox blocked direct loads of Artificial Analysis (AA) and arena.ai, so the figures come from search-result extracts, vendor posts and aggregators. Items marked UNVERIFIED could not be cross-checked. Re-check before quoting on the poster.

## LLMs

### Router (short prompt, JSON out, needs < 0.5–0.8 s)

| Model | AA Intelligence | Time to first token | $/1M in/out | $/100 calls |
|---|---|---|---|---|
| Grok 4 Fast (non-reasoning) | 11 | **0.53 s** | 0.20 / 0.50 | ~$0.03 |
| Gemini 3.5 Flash-Lite | ~34 | fast (UNVERIFIED) | 0.30 / 2.50 | ~$0.05 |
| Claude Haiku 4.5 | 15 | 0.63–0.78 s | 1 / 5 | ~$0.17 |
| GPT-5 nano (minimal) | 7 | 0.81 s | 0.05 / 0.40 | ~$0.01 |
| Claude Sonnet 5 (thinking off) | 38 | not measured | 3 / 15 | ~$0.50 |

Every option is cheap. **Time to first token is the deciding factor.**

### Agent (multi-step browser tool use)

| Model | AA Intelligence | Time to first token | $/1M in/out | $/100 commands (2 steps) |
|---|---|---|---|---|
| Claude Opus 5.5 (low effort) | ~58 (top) | **6.5 s reported, the likely lag source** | 4 / 20 | ~$3.30 cached |
| Claude Sonnet 5 | 38 | faster than Opus | 3 / 15 | ~$2.50 cached |
| Gemini 3.8 Flash | strong agentic scores | fast (262 tok/s) | 0.75 / 3.75 (doubles after 12/31/26) | ~$1.65 |
| Claude Haiku 4.5 | 15–18 | 0.6–0.8 s | 1 / 5 | ~$0.85 |
| Grok 4 Fast (reasoning) | mid | fast | 0.20 / 0.50 | ~$0.44 |

- **Haiku 4.5:** its cost-to-intelligence is now poor, as the user suspected. Its only edge is raw speed.
- **Tool-use leadership:** Anthropic still leads the tool-use and agent leaderboards (tau-bench, WebDev Arena). Gemini 3.8 Flash is the strongest speed/cost alternative.
- **Browser benchmarks:** no current Online-Mind2Web scores were found for Opus 5.5 or Gemini 3.x (UNVERIFIED).

## Live / realtime voice models

| Model | Type | Tool calling | Price |
|---|---|---|---|
| Gemini Live (native audio) | audio-to-audio | yes | ~$0.02/min |
| OpenAI gpt-realtime | audio-to-audio | yes | ~$0.05–0.15/min (mini $0.02–0.05) |
| Grok Voice Agent | audio-to-audio | yes | ~$0.05/min |
| Qwen-Audio-3.1 Realtime | audio-to-audio | yes | UNVERIFIED |

- **How they work:** all of these are true audio-to-audio models, not STT, LLM and TTS glued together.
- **Browser control:** none has published browser-control (DOM) benchmarks. They're proven for conversation, not for "click element 12".
- **Chrome extension constraint:** the live connection has to live in an offscreen document or the side panel.
- **Best use:** as the listen-and-speak front end with a separate agent doing page actions, or as an all-Google experiment.

## Text-to-speech (one voice everywhere)

| Option | Quality | First audio | Cost | Notes |
|---|---|---|---|---|
| Cartesia Sonic 3.6 | #1 in the AA speech arena | ~40–190 ms | paid tiers | best quality + speed |
| Gemini 3.8 Flash TTS | #2 | — | ~$33/1M chars | fits the Google stack |
| ElevenLabs Flash v2.5 | mid-pack | 75 ms | ~$50/1M chars (~$5/mo for Navi) | cheap at low volume |
| **Kokoro-82M, on-device** (kokoro-js, WebGPU/WASM) | not ranked (open weights) | near-instant with WebGPU | **free** | Apache-2.0, 80–300 MB model; calm female voices ("af_heart", "af_bella"); same voice on every OS, fully private |

## Speech-to-text (noise robustness)

| Model | AA-WER streaming | End of speech | Price/hr |
|---|---|---|---|
| Meta Muse Voice Transcribe | 3.1% (#1) | 0.16 s | $0.18 |
| Grok Voice Transcribe 2.0 | 2.7% | 0.49 s | ~$0.10–0.20 |
| ElevenLabs Scribe v2 Realtime | 3.6% | 0.15 s | $0.39 (tested on noisy audio) |
| Deepgram Flux | — | < 0.3 s, built-in turn detection | $0.39 |
| Soniox v5 RT | — | — | $0.12 (noise-robust) |

**In-browser noise suppression:** RNNoise-WASM (~10 ms) or DeepFilterNet-WASM (~40 ms) can clean the mic before any STT, for free. How much they help Chrome's recognizer is UNVERIFIED.

## Candidate stacks (200 commands/day, 30% to the agent, 1 h/day listening)

| Stack | Speech-to-text | Router | Agent | Text-to-speech | ~$/month |
|---|---|---|---|---|---|
| A. Cheap + private | Chrome (on-device) + RNNoise | Grok 4 Fast or Gemini Flash-Lite | Sonnet 5 | Kokoro (on-device) | ~$18–25 |
| B. Best quality | ElevenLabs Scribe v2 RT | Grok 4 Fast | Sonnet 5, escalating to Opus 5.5 | Cartesia Sonic 3.6 | ~$90–110 |
| C. All Google | Gemini Live / Transcribe | Gemini Flash-Lite | Gemini 3.8 Flash | Gemini TTS | ~$35–55 |

**Recommendation from the research:** keep the tiered design:
1. Free local fast path
2. Tiny router
3. Fast agent for 1–2-step actions
4. Escalation to a top model only for complex tasks

One Opus model doing everything would put a multi-second wait on every utterance.

Sources: see the list in the Navi session report (Artificial Analysis model and TTS pages, arena.ai, vendor launch posts for Gemini 3.8 Flash, Grok Voice, Cartesia Sonic 3.6, ElevenLabs Scribe v2 / Flash, Deepgram Flux, Meta Muse, Soniox, Kokoro.js).
