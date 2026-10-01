# Speech-to-text options for Navi (researched 2026-09-24)

**How reliable these numbers are.** The research sandbox's network policy blocked direct page loads of Artificial Analysis, Hugging Face, and most vendor docs. So the figures below come from search-engine extracts of those pages, from Artificial Analysis (AA) posts, and from GitHub. Re-check before quoting them on the poster. Items marked UNVERIFIED could not be confirmed.

## The main finding

AA publishes a **streaming** benchmark ("AA-WER Streaming") that is separate from the non-streaming Word Error Rate index. Streaming is the one that matters for a voice agent.
- **Same audio mix** as the non-streaming index: AgentTalk 50%, VoxPopuli 25%, Earnings22 25%.
- **What it measures:** WER on the first partial and the first final transcript, plus latency after the end of speech.
- **Latency caveat:** AA's latency doesn't include the silence each provider waits before deciding you've stopped talking. So measure time-to-final ourselves.
- **No STT arena exists** at AA or arena.ai (arenas cover TTS and speech-to-speech only).

## Comparison (AA-WER Streaming, final transcript unless noted)

| Provider / model | Latency after speech (AA) | WER | Keyterm boost | Browser-safe auth | $/hr |
|---|---|---|---|---|---|
| xAI Grok Voice Transcribe 2.0 | 0.49 s | **2.7%** | yes | ephemeral client secret (STT use UNVERIFIED) | 0.20 |
| Meta Muse Voice Transcribe | 0.16 s | 3.1% | yes | UNVERIFIED | 0.18 |
| Cartesia Ink-2 | 0.09–0.21 s | 3.6% | yes | scoped access token | 0.24 |
| ElevenLabs Scribe v2 Realtime | 0.14 s | 3.6% | yes (~50 terms) | single-use token | 0.39 |
| Soniox v5 Real-Time | 0.05 s | 4.5% | yes | temporary API key | 0.12 |
| AssemblyAI Universal-3.5 Pro RT | 0.44 s (first partial) | 4.1% (first partial) | yes | temporary token | 0.45 |
| OpenAI `gpt-realtime-whisper` | UNVERIFIED | 5.1% | prompt only | ephemeral secret | ~1.02 |
| Deepgram Flux / Nova-3 RT | 0.02 s / 0.06 s | 7.4% / 6.7% (first partial) | yes (up to 100) | short-lived JWT | 0.39 / ~0.29 |
| Chrome on-device Web Speech | ~0.5–1 s (anecdotal) | UNVERIFIED | `phrases` (Chrome 142+) | none needed | free |
| Moonshine v2 Streaming Medium (WASM) | 258 ms (paper) | 6.65% (Open ASR, offline) | no | none needed | free |

## Recommendation

1. **Now (in the MVP):** Chrome's Web Speech API with on-device processing (`processLocally`, Chrome 139+). It's free, needs no key, and keeps audio local where supported. Navi uses on-device mode only, never the cloud.
2. **Next, for accuracy and latency:** ElevenLabs Scribe v2 Realtime. It's on the Pareto front, has keyterms, voice-activity auto-commit, and an official single-use-token flow for browsers. Alternatives:
   - Soniox: cheapest, and marks end of speech with an `<end>` token.
   - Grok 2.0: best WER.
   - Deepgram: $200 free credit.
3. **Private and controllable:** Moonshine v2 via WASM, or `parakeet.js` (ONNX Runtime Web + WebGPU). Needs `'wasm-unsafe-eval'` in the CSP, which Navi's manifest already sets.

## Evaluation plan (for the poster)

- **Recordings:** 50 commands as 16 kHz mono WAV, from 2–3 speakers, with a quiet set and a noisy set. About half should contain entities (GitHub, Canvas, Vercel, contact names).
- **Labels:** hand-label a reference transcript, the entities, and the end-of-speech time for each file.
- **Replay:** stream each file in real time (20–40 ms chunks) through 3 providers. Run once with the same keyterm list for all, and once without keyterms.
- **Metrics:**
  - Normalized WER (jiwer)
  - Entity accuracy
  - Command exact-match rate
  - Time-to-final from end of speech (p50/p95)
  - Premature cut-offs on long commands
  - Cost per 50 commands

## Sources

- https://artificialanalysis.ai/articles/new-streaming-speech-to-text-benchmark-aa-wer-streaming
- https://artificialanalysis.ai/speech-to-text/streaming
- https://huggingface.co/spaces/hf-audio/open_asr_leaderboard
- https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming
- https://soniox.com/docs/guides/temporary-api-keys
- https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- https://developers.deepgram.com/reference/auth/tokens/grant
- https://www.assemblyai.com/docs/universal-streaming/authenticate-with-a-temporary-token
- https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md
- https://chromestatus.com/feature/6090916291674112
- https://github.com/moonshine-ai/moonshine-js, https://github.com/ysdede/parakeet.js
