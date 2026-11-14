"""Real people saying single words (Google Speech Commands v0.02, CC BY 4.0), as a benchmark set.

Usage: python3 bench/asr/humanset.py <speech_commands dir> <out dir> [per word]
Takes clips from the dataset's test speakers, pads them like a command said into a quiet mic, and writes
words.txt (for expect.mjs) and index.json (for transcribe.py).
"""
import json, os, random, sys
import numpy as np
import soundfile as sf

src, out = sys.argv[1:3]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 40
WORDS = ["stop", "go", "up", "down", "yes", "no", "on", "off", "left", "right", "forward", "backward", "follow"]
os.makedirs(out, exist_ok=True)
test = set(open(f"{src}/testing_list.txt").read().split())
rng = random.Random(3)
index = []
with open(f"{out}/words.txt", "w") as f:
    f.write("[human]\n" + "\n".join(WORDS) + "\n")
for wi, w in enumerate(WORDS):
    files = sorted(p for p in test if p.startswith(f"{w}/"))
    for p in rng.sample(files, min(per, len(files))):
        x, sr = sf.read(f"{src}/{p}", dtype="float32")
        y = np.concatenate([np.zeros(4800, np.float32), x, np.zeros(9600, np.float32)])
        name = p.replace("/", "-")
        sf.write(f"{out}/{name}", y, 16000, subtype="PCM_16")
        index.append({"file": name, "phrase": wi, "voice": p.split("/")[1].split("_")[0], "speed": 1})
json.dump(index, open(f"{out}/index.json", "w"))
print(len(index), "clips")
