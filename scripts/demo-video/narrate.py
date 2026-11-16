"""Speech for the demo video: the user saying each command (OpenAI's gpt-4o-mini-tts, a natural voice),
and Navi's replies in Navi's own voice (Kokoro af_heart, its default, via sherpa-onnx).

Usage:
  python3 scripts/demo-video/narrate.py lines <script.json> <kokoro dir> <out dir>
      the user's commands (before recording, so it knows how long each takes)
  python3 scripts/demo-video/narrate.py say <script.json> <kokoro dir> <out dir> <key> <text>
      one more user line, made during the recording ("click 76": the number is only known then)
  python3 scripts/demo-video/narrate.py replies <script.json> <kokoro dir> <out dir> <events.json>
      what Navi said during the recording
Writes <out dir>/<key>.wav and durations json. Navi's lines fail on a word Kokoro's dictionary lacks (it
would silently skip it) unless a respelling or the stem rules cover it. The user's voice needs an OpenAI key
(OPENAI_API_KEY, or a proxy that adds it); its clips are cached by text.
"""
import hashlib, io, json, os, re, ssl, subprocess, sys, urllib.request
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
    "chrome's": "chromes", "wikipedia": "wicky pee dee uh", "bitly": "bit lee", "qr": "cue are", "ublock": "you block",
}
lexicon = set()
phones = {}
for f in ("lexicon-us-en.txt", "lexicon-gb-en.txt") if mode != "say" else ():
    for line in open(f"{kokoro}/{f}", encoding="utf8"):
        word, _, ph = line.rstrip("\n").partition(" ")
        lexicon.add(word.lower())
        phones.setdefault(word.lower(), ph)

def derived(word):
    """Sounds for a word the dictionary lacks but whose stem it has ("opened", "commenters", "urls"): Navi's
    replies aren't scripted, and Kokoro silently skips unknown words."""
    w = word.lower()
    rules = [("ies", "y", " z"), ("es", "", " ɪ z"), ("s", "", " z"), ("ied", "y", " d"), ("ed", "", " d"), ("ed", "e", " d"), ("ing", "", " ɪ ŋ"), ("ing", "e", " ɪ ŋ"), ("er", "", " ə ɹ"), ("ers", "", " ə ɹ z")]
    for end, add, tail in rules:
        stem = w[: -len(end)] + add if w.endswith(end) else None
        if stem and stem in phones:
            if end in ("ed",) and stem[-1:] in ("t", "d"):
                tail = " ɪ d"
            return phones[stem] + tail
    return None

# Missing words with a known stem go into an extra dictionary for this run.
EXTRA = os.path.join(out, "extra-lexicon.txt")
extra = {}

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()

def number_words(n):
    """Numbers as words, below a million (Kokoro's sherpa-onnx frontend skips digits)."""
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + number_words(n % 100))
    return number_words(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + number_words(n % 1000))

def spell_numbers(text):
    text = re.sub(r"\$(\d+)\b", lambda m: number_words(int(m.group(1))) + " dollars", text)
    text = re.sub(r"\b(\d+)K\b", lambda m: number_words(int(m.group(1))) + " thousand", text)
    return re.sub(r"\b\d{1,6}\b", lambda m: number_words(int(m.group(0))), text)

LETTERS = {c: n for c, n in zip("abcdefghijklmnopqrstuvwxyz", "ay bee see dee ee eff gee aitch eye jay kay el em en oh pee cue are ess tee you vee double-you ex why zee".split())}
LETTERS["w"] = "double you"

def spoken(text):
    text = re.sub(r"(?<=\w)-(?=\w)", " ", text)  # "QR-code", "third-party": the words, said
    # Kokoro's sherpa-onnx frontend skips words stuck to brackets, and "·": both are pauses when said.
    text = spell_numbers(re.sub(r"\s*[·()]\s*", ", ", text)).replace(", ,", ",")
    out_words = []
    for raw in text.split():
        core = re.sub(r"^[^\w$']+|[^\w']+$", "", raw).lower()
        tail = raw[len(raw.rstrip(".,!?:;")):]
        if core in SAY:
            out_words.append(SAY[core] + tail)
        elif re.fullmatch(r"[A-Z]{2,4}s?", raw.strip(".,!?:;“”\"'")):
            # An acronym ("QR", "URLs"): its letters.
            letters = raw.strip(".,!?:;“”\"'")
            plural = letters.endswith("s")
            out_words.append(" ".join(LETTERS[c.lower()] for c in (letters[:-1] if plural else letters)) + ("s" if plural else "") + tail)
        else:
            out_words.append(raw)
    said = " ".join(out_words)
    missing = []
    for w in re.findall(r"[a-z']+", said.lower()):
        if w in lexicon or w.strip("'") in lexicon:
            continue
        ph = derived(w.strip("'"))
        if ph:
            extra[w.strip("'")] = ph
        else:
            missing.append(w)
    return said, missing

def trimmed(x, sr, pad=0.06):
    """Without the silence around the words."""
    loud = np.flatnonzero(np.abs(x) > 0.012)
    if not len(loud):
        return x
    a, b = max(0, loud[0] - int(pad * sr)), min(len(x), loud[-1] + int(pad * sr))
    return x[a:b]

def user_voice(text):
    """The user's line in OpenAI's voice (24 kHz), cached by text."""
    v = script["userVoice"]
    cache = os.path.join(os.path.dirname(os.path.abspath(out)), "tts-cache")
    os.makedirs(cache, exist_ok=True)
    key = hashlib.sha1(json.dumps([v, text]).encode()).hexdigest()[:16]
    path = f"{cache}/{key}.pcm"
    if not os.path.exists(path):
        body = json.dumps({"model": v["model"], "voice": v["voice"], "input": text, "instructions": v["instructions"], "response_format": "pcm"}).encode()
        req = urllib.request.Request("https://api.openai.com/v1/audio/speech", data=body, headers={
            "Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', 'sk-proxy')}", "Content-Type": "application/json"})
        ca = "/root/.ccr/ca-bundle.crt"
        ctx = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
        with urllib.request.urlopen(req, context=ctx, timeout=90) as r:
            open(path, "wb").write(r.read())
    x = np.frombuffer(open(path, "rb").read(), dtype="<i2").astype(np.float32) / 32768
    speed = v.get("speed", 1.0)
    if speed != 1.0:
        # Faster at the same pitch (ffmpeg's atempo).
        raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-af", f"atempo={speed}", "-f", "f32le", "pipe:1"],
                             input=x.tobytes(), capture_output=True, check=True).stdout
        x = np.frombuffer(raw, dtype=np.float32)
    return trimmed(x, 24000), 24000

lines = {}
if mode == "lines":
    for i, step in enumerate(script["steps"]):
        # A line whose words are only known while recording ("click 76") is made then.
        if "say" in step and "clickLink" not in step:
            lines[f"s{i}"] = ("user", step["say"])
elif mode == "say":
    key, text = sys.argv[5], sys.argv[6]
    x, sr = user_voice(text)
    sf.write(f"{out}/{key}.wav", x, sr)
    print(f"{len(x) / sr:.3f}")
    sys.exit(0)
else:
    events = json.load(open(sys.argv[5]))["events"]
    for i, e in enumerate(e for e in events if e["kind"] == "navi"):
        # A long reading is cut short by the next command in the video: only its start is said.
        text = e["text"]
        if len(text) > 400:
            text = text[:400].rsplit(". ", 1)[0] + "."
        lines[f"navi-{i}"] = ("navi", text)

extra = {}
problems = []
prepared = {}
for key, (who, text) in lines.items():
    if who == "user":
        prepared[key] = (who, text)
        continue
    said, missing = spoken(text)
    if missing:
        problems.append(f"{key}: {missing} in {text!r}")
    prepared[key] = (who, said)
if problems and mode == "lines":
    raise SystemExit("Words Kokoro doesn't know (add them to SAY):\n" + "\n".join(problems))
# Navi's replies come from the live AI: a word left over is noted, not fatal (it's skipped when said).
for p in problems:
    print("Skipped when said:", p)
os.makedirs(out, exist_ok=True)
with open(EXTRA, "w", encoding="utf8") as f:
    for word, ph in extra.items():
        f.write(f"{word} {ph}\n")

cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(model=f"{kokoro}/model.onnx", voices=f"{kokoro}/voices.bin", tokens=f"{kokoro}/tokens.txt",
        data_dir=f"{kokoro}/espeak-ng-data", dict_dir=f"{kokoro}/dict", lexicon=f"{kokoro}/lexicon-us-en.txt,{kokoro}/lexicon-gb-en.txt" + (f",{EXTRA}" if extra else ""), lang="en-us"),
    num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
durations = {}
for key, (who, said) in prepared.items():
    if who == "user":
        x, sr = user_voice(said)
    else:
        # Navi at its own default pace.
        audio = tts.generate(said, sid=script["naviVoice"], speed=1.05)
        x, sr = trimmed(np.asarray(audio.samples, dtype=np.float32), audio.sample_rate), audio.sample_rate
    sf.write(f"{out}/{key}.wav", x, sr)
    durations[key] = len(x) / sr
json.dump(durations, open(f"{out}/durations{'' if mode == 'lines' else '-replies'}.json", "w"), indent=1)
print(f"{len(durations)} clips, {sum(durations.values()):.1f} s of speech")
