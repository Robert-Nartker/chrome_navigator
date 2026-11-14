"""Cuts each clip the way Navi hands audio to a model recognizer: Silero VAD + PhraseDetector (src/voice/phrases.ts),
with its lead-in (preroll) and the quiet tail that ends a phrase. Writes the phrase audio as new clips, so the
recognizers are scored on exactly what Navi would give them. Clips should have room around the speech (see
--context in the README): a phrase can only get its lead-in and tail if there's audio there.

Usage: python3 bench/asr/navicut.py <silero onnx> <clips dir> <out dir> [start=0.5 minvoiced=150 …, as vadsim.py]
"""
import json, os, sys
import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(__file__))
import vadsim  # noqa: E402  (reuses its Silero and PhraseDetector simulation)

model, clips, out = sys.argv[1:4]
vadsim.T.update({k: float(v) for k, v in (a.split("=") for a in sys.argv[4:])})
vadsim.load(model)
os.makedirs(out, exist_ok=True)
index = json.load(open(f"{clips}/index.json"))
kept_index, none = [], 0
for it in index:
    x, _ = sf.read(f"{clips}/{it['file']}", dtype="float32")
    found = [p for p in vadsim.phrases(vadsim.probabilities(x)) if p["kept"]]
    if not found:
        none += 1
        continue
    # The longest phrase is the command (a click before it would be its own, short phrase).
    p = max(found, key=lambda p: p["frames"])
    # What PhraseDetector hands on: its lead-in, the frame speech began, and every frame after to the end of the tail.
    start = (p["start"] - p["pre"]) * vadsim.FRAME
    end = (p["start"] + 1 + p["frames"] - p["pre"]) * vadsim.FRAME
    sf.write(f"{out}/{it['file']}", x[start:min(len(x), end)], 16000)
    kept_index.append({**it, "phrases": len(found)})
json.dump(kept_index, open(f"{out}/index.json", "w"))
print(f"{os.path.basename(clips.rstrip('/'))}: {len(kept_index)} phrases cut, {none} clips with none", flush=True)
