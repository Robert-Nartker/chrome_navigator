"""Keyword spotting for Navi's short commands: a 3.3M-parameter streaming model (sherpa-onnx KWS zipformer,
trained on GigaSpeech) that listens only for a fixed list of phrases. Does it catch the short commands
the full recognizers miss through a headset, and how often does it fire on words that aren't commands?

Usage: python3 bench/asr/kws.py <models dir> <phrases.json> <clips dir> <out json> [--keywords k1,k2,...] [--threshold 0.25] [--score 1.0]
"""
import argparse, json, os
import numpy as np
import soundfile as sf
import sherpa_onnx

ap = argparse.ArgumentParser()
ap.add_argument("models"); ap.add_argument("phrases"); ap.add_argument("clips"); ap.add_argument("out")
ap.add_argument("--keywords", default="pause,play,stop,mute,unmute,refresh,reload,scroll down,scroll up,go back,go forward,close tab,new tab,next tab,previous tab,zoom in,zoom out,show numbers,hide numbers,pause the video,play the video,go to sleep,wake up,turn off,page down,page up")
ap.add_argument("--threshold", type=float, default=0.25)
ap.add_argument("--score", type=float, default=1.0)
a = ap.parse_args()
d = f"{a.models}/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
words = [w.strip() for w in a.keywords.split(",") if w.strip()]
toks = sherpa_onnx.text2token([w.upper() for w in words], tokens=f"{d}/tokens.txt", tokens_type="bpe", bpe_model=f"{d}/bpe.model")
kwfile = f"{a.out}.keywords.txt"
with open(kwfile, "w") as f:
    for w, t in zip(words, toks):
        f.write(" ".join(t) + f" :{a.score} #{a.threshold} @{w.replace(' ', '_')}\n")
kws = sherpa_onnx.KeywordSpotter(
    tokens=f"{d}/tokens.txt", encoder=f"{d}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    decoder=f"{d}/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", joiner=f"{d}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    keywords_file=kwfile, num_threads=2, keywords_score=a.score, keywords_threshold=a.threshold, max_active_paths=4)
phrases = json.load(open(a.phrases))
index = json.load(open(f"{a.clips}/index.json"))
res = []
for it in index:
    x, sr = sf.read(f"{a.clips}/{it['file']}", dtype="float32")
    s = kws.create_stream()
    s.accept_waveform(sr, x)
    s.accept_waveform(sr, np.zeros(int(sr * 0.5), np.float32))
    s.input_finished()
    found = []
    while kws.is_ready(s):
        kws.decode_stream(s)
        r = kws.get_result(s)
        if r:
            found.append(r.replace("_", " "))
            kws.reset_stream(s)
    said = phrases[it["phrase"]]["text"]
    res.append({**it, "said": said, "found": found})
target = [r for r in res if r["said"] in words]
other = [r for r in res if r["said"] not in words]
hit = sum(1 for r in target if r["said"] in r["found"])
wrong = sum(1 for r in target if r["found"] and r["said"] not in r["found"])
false = sum(1 for r in other if r["found"])
json.dump({"clips": a.clips, "threshold": a.threshold, "score": a.score, "results": res}, open(a.out, "w"))
name = a.clips.rstrip("/").split("/")[-1]
print(f"{name} t={a.threshold} s={a.score}: keywords caught {hit}/{len(target)} ({hit / max(1, len(target)):.0%}), wrong {wrong}, fired on non-keywords {false}/{len(other)} ({false / max(1, len(other)):.0%})", flush=True)
