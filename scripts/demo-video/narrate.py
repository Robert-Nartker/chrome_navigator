"""Speech for the demo video, with Kokoro (via sherpa-onnx): the narrator, the user saying each command,
and Navi's replies, in three different voices.

Usage:
  python3 scripts/demo-video/narrate.py lines <script.json> <kokoro dir> <out dir>
      the narrator's lines and the user's commands (before recording, so it knows how long each takes)
  python3 scripts/demo-video/narrate.py replies <script.json> <kokoro dir> <out dir> <events.json>
      what Navi said during the recording, in Navi's own voice (af_heart, its default)
Writes <out dir>/<key>.wav and <out dir>/durations.json. Fails on any word Kokoro's dictionary lacks
(it would silently skip it) unless the respelling table covers it.
"""
import json, os, re, sys
import numpy as np
import soundfile as sf
import sherpa_onnx

mode, script_file, kokoro, out = sys.argv[1:5]
script = json.load(open(script_file))
os.makedirs(out, exist_ok=True)

# Words Kokoro's dictionary lacks, spelled the way they're said.
SAY = {
    "navi": "nah vee", "navi's": "nah vees", "ai": "A I", "github": "git hub", "lofi": "low fee", "url": "U R L",
    "deskly": "desk lee", "flexdesk": "flex desk", "$379": "three seventy nine dollars", "379": "three seventy nine",
    "400": "four hundred", "7": "seven", "flag's": "flags",
}
lexicon = set()
for f in ("lexicon-us-en.txt", "lexicon-gb-en.txt"):
    for line in open(f"{kokoro}/{f}", encoding="utf8"):
        lexicon.add(line.split(" ", 1)[0].lower())

def spoken(text):
    out_words = []
    for raw in text.split():
        core = re.sub(r"^[^\w$']+|[^\w']+$", "", raw).lower()
        tail = raw[len(raw.rstrip(".,!?:;")):]
        if core in SAY:
            out_words.append(SAY[core] + tail)
        else:
            out_words.append(raw)
    said = " ".join(out_words)
    missing = [w for w in re.findall(r"[a-z']+", said.lower()) if w not in lexicon and w.strip("'") not in lexicon]
    return said, missing

cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=f"{kokoro}/model.onnx", voices=f"{kokoro}/voices.bin", tokens=f"{kokoro}/tokens.txt",
        data_dir=f"{kokoro}/espeak-ng-data", dict_dir=f"{kokoro}/dict", lexicon=f"{kokoro}/lexicon-us-en.txt,{kokoro}/lexicon-gb-en.txt", lang="en-us"),
    num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
voices = script["voices"]

lines = {}
if mode == "lines":
    lines["title"] = ("narrator", script["title"]["narrator"])
    lines["end"] = ("narrator", script["end"]["narrator"])
    for si, scene in enumerate(script["scenes"]):
        for ti, step in enumerate(scene["steps"]):
            if "narrator" in step:
                lines[f"s{si}-{ti}-narrator"] = ("narrator", step["narrator"])
            if "say" in step:
                lines[f"s{si}-{ti}-say"] = ("user", step["say"])
else:
    events = json.load(open(sys.argv[5]))["events"]
    for i, e in enumerate(e for e in events if e["kind"] == "navi"):
        lines[f"navi-{i}"] = ("navi", e["text"])

durations = {}
problems = []
for key, (who, text) in lines.items():
    said, missing = spoken(text)
    if missing:
        problems.append(f"{key}: {missing} in {text!r}")
        continue
    # A touch slower for the narrator; Navi at its own default pace.
    speed = {"narrator": 0.95, "user": 1.0, "navi": 1.05}[who]
    audio = tts.generate(said, sid=voices[who], speed=speed)
    x = np.asarray(audio.samples, dtype=np.float32)
    sf.write(f"{out}/{key}.wav", x, audio.sample_rate)
    durations[key] = len(x) / audio.sample_rate
if problems:
    raise SystemExit("Words Kokoro doesn't know (add them to SAY):\n" + "\n".join(problems))
json.dump(durations, open(f"{out}/durations{'' if mode == 'lines' else '-replies'}.json", "w"), indent=1)
print(f"{len(durations)} clips, {sum(durations.values()):.1f} s of speech")
