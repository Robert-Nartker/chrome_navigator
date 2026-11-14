"""Says every benchmark phrase in many voices (Kokoro and Piper, via sherpa-onnx), as 16 kHz mono WAVs.

Usage: python3 bench/asr/synth.py <phrases.json> <models dir> <out dir>
Each clip gets 0.3 s of silence before and 0.6 s after, like a command said into a quiet mic.
"""
import json, os, random, sys
import numpy as np
import soundfile as sf
import sherpa_onnx
from scipy.signal import resample_poly

phrases_file, models, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
phrases = json.load(open(phrases_file))
rng = random.Random(7)

KOKORO = f"{models}/kokoro-multi-lang-v1_0"

def kokoro():
    d = KOKORO
    cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=f"{d}/model.onnx", voices=f"{d}/voices.bin", tokens=f"{d}/tokens.txt",
            data_dir=f"{d}/espeak-ng-data", dict_dir=f"{d}/dict", lexicon=f"{d}/lexicon-us-en.txt,{d}/lexicon-gb-en.txt", lang="en-us"),
        num_threads=4))
    return sherpa_onnx.OfflineTts(cfg)

def piper(name):
    d = f"{models}/{name}"
    onnx = [f for f in os.listdir(d) if f.endswith(".onnx")][0]
    cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f"{d}/{onnx}", tokens=f"{d}/tokens.txt", data_dir=f"{d}/espeak-ng-data"),
        num_threads=4))
    return sherpa_onnx.OfflineTts(cfg)

# (engine, speaker id, label)
voices = []
engines = {}
if os.path.isdir(KOKORO):
    engines["kokoro"] = kokoro()
    # Kokoro v1.0's English voices: American and British, women and men.
    names = ["af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah",
             "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
             "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis"]
    picks = dict(enumerate(names))
    voices += [("kokoro", sid, f"kokoro-{n}") for sid, n in picks.items()]
# (Piper voices need a phoneme front end that this sherpa-onnx build no longer has: Kokoro's 28 English voices
# give the variety, and Google Speech Commands gives real people.)
for name, count in []:
    if os.path.isdir(f"{models}/{name}"):
        engines[name] = piper(name)
        n = engines[name].num_speakers
        sids = rng.sample(range(n), count) if n > 1 else [0]
        voices += [(name, s, f"{name.split('-')[2]}-{s}") for s in sids]

# How each phrase is said: numbers as words, and words Kokoro's dictionary lacks spelled the way they sound
# (it skips unknown words). The expected command stays the phrase as written.
SAY = {"10": "ten", "12": "twelve", "3": "three", "30": "thirty", "5": "five", "gmail": "gee mail", "lofi": "low fee",
       "reviews": "re views", "that's": "that is", "what's": "what is", "wikipedia": "wiki pee dee ah"}

def spoken(text):
    return " ".join(SAY.get(w, w) for w in text.split())

index = []
for vi, (engine, sid, label) in enumerate(voices):
    tts = engines[engine]
    for pi, p in enumerate(phrases):
        # People say commands at different speeds.
        speed = rng.choice([0.9, 1.0, 1.0, 1.1, 1.2])
        name = f"{pi:03d}-{label}.wav"
        if os.path.exists(f"{out}/{name}"):
            # Already made (a resumed run).
            index.append({"file": name, "phrase": pi, "voice": label, "speed": speed})
            continue
        audio = tts.generate(spoken(p["text"]), sid=sid, speed=speed)
        if not audio.sample_rate or not len(audio.samples):
            print(f"{label}: no audio for {p['text']!r}", flush=True)
            continue
        x = np.asarray(audio.samples, dtype=np.float32)
        y = resample_poly(x, 16000, audio.sample_rate).astype(np.float32)
        y = np.concatenate([np.zeros(4800, np.float32), y, np.zeros(9600, np.float32)])
        sf.write(f"{out}/{name}", y, 16000, subtype="PCM_16")
        index.append({"file": name, "phrase": pi, "voice": label, "speed": speed})
    print(f"{label}: {len(phrases)} clips", flush=True)
json.dump(index, open(f"{out}/index.json", "w"), indent=0)
print("clips", len(index))
