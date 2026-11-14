"""Navi's phrase detection (src/voice/phrases.ts + the Silero VAD it ships) on benchmark clips: does a
command become a phrase at all, and how much of it? A phrase that never starts, or that Parakeet's
listener drops as too short, is a command that "didn't register" before any recognizer saw it.

Usage: python3 bench/asr/vadsim.py <silero onnx> <clips dir> <out json> [start=0.5 still=0.35 hang=350 preroll=300 minvoiced=150 minphrase=0.3]
"""
import json, sys
import numpy as np
import onnxruntime as ort
import soundfile as sf

model, clips, out = sys.argv[1:4]
opts = dict(a.split("=") for a in sys.argv[4:])
T = dict(start=0.5, still=0.35, hang=350, preroll=300, minvoiced=150, minphrase=0.3)
T.update({k: float(v) for k, v in opts.items()})
FRAME, RATE, CONTEXT = 512, 16000, 64
FRAME_MS = FRAME / RATE * 1000

so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
sr = np.array(16000, dtype=np.int64)

def probabilities(x):
    state = np.zeros((2, 1, 128), np.float32)
    context = np.zeros(CONTEXT, np.float32)
    probs = []
    for at in range(0, len(x) - FRAME + 1, FRAME):
        frame = x[at:at + FRAME].astype(np.float32)
        inp = np.concatenate([context, frame])[None, :]
        o, state = sess.run(None, {"input": inp, "state": state, "sr": sr})
        context = frame[-CONTEXT:]
        probs.append(float(o[0][0]))
    return probs

def phrases(probs):
    """PhraseDetector.onFrame, frame by frame: the phrases it ends (in frames), as Navi would hand them on."""
    found, talking, preroll, length, quiet, voiced, first = [], False, 0, 0, 0.0, 0.0, 0
    max_pre = int(T["preroll"] // FRAME_MS)
    for i, p in enumerate(probs):
        if not talking:
            preroll = min(preroll + 1, max_pre + 1) if preroll <= max_pre else max_pre
            if p < T["start"]:
                continue
            talking, first, length, quiet, voiced = True, i, min(preroll, max_pre), 0.0, FRAME_MS
            preroll = 0
            continue
        length += 1
        if p >= T["still"]:
            voiced += FRAME_MS; quiet = 0.0
        else:
            quiet += FRAME_MS
        if quiet >= T["hang"]:
            found.append({"start": first, "frames": length, "voicedMs": voiced, "kept": voiced >= T["minvoiced"] and length * FRAME / RATE >= T["minphrase"]})
            talking = False
    if talking:
        found.append({"start": first, "frames": length, "voicedMs": voiced, "kept": voiced >= T["minvoiced"] and length * FRAME / RATE >= T["minphrase"], "open": True})
    return found

index = json.load(open(f"{clips}/index.json"))
res = []
for it in index:
    x, _ = sf.read(f"{clips}/{it['file']}", dtype="float32")
    probs = probabilities(x)
    ph = phrases(probs)
    res.append({**it, "peak": max(probs) if probs else 0, "phrases": len([p for p in ph if p["kept"]]), "dropped": len([p for p in ph if not p["kept"]])})
json.dump({"clips": clips, "tuning": T, "results": res}, open(out, "w"))
none = sum(1 for r in res if r["phrases"] == 0)
split = sum(1 for r in res if r["phrases"] > 1)
print(f"{clips.rstrip('/').split('/')[-1]}: {len(res)} clips, no phrase {none} ({none / len(res):.0%}), split {split}", flush=True)
