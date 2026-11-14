"""Runs a recognizer over a folder of clips and saves what it heard.

Usage: python3 bench/asr/transcribe.py <model> <models dir> <clips dir> <out json> [--hotwords file] [--hotword-score 1.5]
Models: parakeet (NVIDIA Parakeet TDT 0.6B v2, as Navi uses), whisper-tiny / whisper-base / whisper-small (English),
moonshine-tiny / moonshine-base. All run on the processor, int8 where available.
"""
import argparse, json, os, sys, time
import soundfile as sf
import sherpa_onnx

ap = argparse.ArgumentParser()
ap.add_argument("model"); ap.add_argument("models"); ap.add_argument("clips"); ap.add_argument("out")
ap.add_argument("--hotwords"); ap.add_argument("--hotword-score", type=float, default=1.5)
ap.add_argument("--threads", type=int, default=4)
ap.add_argument("--normalize", type=float, help="bring the loudest 100 ms of speech to this level (dBFS) first")
a = ap.parse_args()
M, T = a.models, a.threads

def make(name):
    if name == "parakeet":
        d = f"{M}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
        extra = {}
        if a.hotwords:
            extra = dict(decoding_method="modified_beam_search", hotwords_file=a.hotwords, hotwords_score=a.hotword_score, max_active_paths=4,
                         modeling_unit="bpe", bpe_vocab=f"{d}/bpe.vocab")
        return sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=f"{d}/encoder.int8.onnx", decoder=f"{d}/decoder.int8.onnx", joiner=f"{d}/joiner.int8.onnx",
            tokens=f"{d}/tokens.txt", num_threads=T, model_type="nemo_transducer", **extra)
    if name.startswith("whisper-"):
        size = name.split("-")[1]
        d = f"{M}/sherpa-onnx-whisper-{size}.en"
        return sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=f"{d}/{size}.en-encoder.int8.onnx", decoder=f"{d}/{size}.en-decoder.int8.onnx",
            tokens=f"{d}/{size}.en-tokens.txt", language="en", task="transcribe", num_threads=T)
    if name.startswith("moonshine-"):
        size = name.split("-")[1]
        d = f"{M}/sherpa-onnx-moonshine-{size}-en-int8"
        return sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=f"{d}/preprocess.onnx", encoder=f"{d}/encode.int8.onnx",
            uncached_decoder=f"{d}/uncached_decode.int8.onnx", cached_decoder=f"{d}/cached_decode.int8.onnx",
            tokens=f"{d}/tokens.txt", num_threads=T)
    raise SystemExit(f"unknown model {name}")

rec = make(a.model)
index = json.load(open(f"{a.clips}/index.json"))
results = []
started = time.time()
audio_s = 0.0
BATCH = 8
for i in range(0, len(index), BATCH):
    items = index[i:i + BATCH]
    streams = []
    for it in items:
        x, sr = sf.read(f"{a.clips}/{it['file']}", dtype="float32")
        audio_s += len(x) / sr
        if a.normalize is not None:
            import numpy as np
            win = int(sr * 0.1)
            loud = max((float(np.sqrt(np.mean(x[i:i + win] ** 2))) for i in range(0, max(1, len(x) - win), win // 2)), default=0) + 1e-9
            x = np.clip(x * (10 ** (a.normalize / 20) / loud), -1, 1).astype("float32")
        s = rec.create_stream()
        s.accept_waveform(sr, x)
        streams.append(s)
    rec.decode_streams(streams)
    for it, s in zip(items, streams):
        results.append({**it, "heard": s.result.text.strip()})
elapsed = time.time() - started
json.dump({"model": a.model + (" +hotwords" if a.hotwords else "") + (f" +norm{a.normalize:g}" if a.normalize is not None else ""), "clips": a.clips, "seconds": elapsed, "audio_seconds": audio_s,
           "results": results}, open(a.out, "w"), indent=0)
print(f"{a.model} {os.path.basename(a.clips)}: {len(results)} clips in {elapsed:.0f}s ({audio_s / elapsed:.1f}x realtime)", flush=True)
