#!/bin/bash
# Downloads the sherpa-onnx builds of each model (GitHub releases, ~6 GB unpacked) and a few
# background-noise recordings (Microsoft MS-SNSD) into this folder. Safe to re-run: finished models are skipped.
set -u
cd "$(dirname "$0")"
B=https://github.com/k2-fsa/sherpa-onnx/releases/download
mkdir -p models noise
for n in Babble_1 Typing_1 AirConditioner_1 Neighbor_1 Munching_1 VacuumCleaner_1 CopyMachine_1 AirportAnnouncements_1; do
  [ -e "noise/$n.wav" ] || curl -sSLf "https://raw.githubusercontent.com/microsoft/MS-SNSD/master/noise_test/$n.wav" -o "noise/$n.wav"
done
cd models
for f in \
  tts-models/kokoro-multi-lang-v1_0 \
  tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26 \
  tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11 \
  tts-models/kitten-mini-en-v0_1-fp16 \
  tts-models/kitten-nano-en-v0_2-fp16 \
  tts-models/vits-piper-en_US-lessac-medium \
  asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 \
  asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 \
  asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25 \
  asr-models/sherpa-onnx-moonshine-base-en-quantized-2026-02-27 \
  asr-models/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27 \
  asr-models/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8 \
  asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25 \
  asr-models/sherpa-onnx-whisper-small.en \
  asr-models/sherpa-onnx-whisper-distil-large-v3.5 \
  asr-models/sherpa-onnx-whisper-turbo ; do
  name=$(basename "$f")
  [ -e "$name.done" ] && continue
  echo "$(date +%T) $name"
  curl -sSLf --retry 3 "$B/$f.tar.bz2" -o "$name.tar.bz2" && tar xjf "$name.tar.bz2" && rm "$name.tar.bz2" && touch "$name.done" || echo "FAILED $name"
done
