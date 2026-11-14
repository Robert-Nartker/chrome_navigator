"""Turns a recording saved by the recognizer tester ("Record your mic for Navi's speech tests") into a
benchmark set: one WAV per command, an index.json like synth.py's, and a phrases.txt for expect.mjs.

Usage: python3 bench/asr/ingest.py <navi-mic-….json> <out dir>
Then, as for any set (see README): expect.mjs on <out dir>/phrases.txt, navicut.py, transcribe.py, score.mjs.
"""
import base64, json, os, sys

src, out = sys.argv[1:3]
data = json.load(open(src))
if data.get("kind") != "navi-mic-recording":
    raise SystemExit("Not a recording from Navi's recognizer tester.")
os.makedirs(out, exist_ok=True)
index, texts = [], []
for i, clip in enumerate(data["clips"]):
    name = f"{i:03d}-mine.wav"
    with open(f"{out}/{name}", "wb") as f:
        f.write(base64.b64decode(clip["wav"]))
    index.append({"file": name, "phrase": i, "voice": "mine", "speed": 1})
    texts.append(clip["text"].lower())
json.dump(index, open(f"{out}/index.json", "w"))
with open(f"{out}/phrases.txt", "w") as f:
    f.write("# Said into " + (data.get("device") or "the default mic") + "\n[mine]\n" + "\n".join(texts) + "\n")
print(f"{len(index)} clips from {data.get('device') or 'the default mic'} -> {out}")
