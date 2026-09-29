# Speech lab, part 2: on-device speech recognition on Navi's own commands.
#   python3 asr.py build            # speak every phrase with a different synthetic voice, clean and noisy
#   python3 asr.py decode [names]   # transcribe the set with each recognizer; results in out/asr/
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

import voices as V

M = Path("models")
OUT = Path("out/asr")
SET = Path("out/testset")
random.seed(7)

BUILT_INS = [
    "hey navi", "hey navi scroll down", "hey navi what time is it", "hey navi go to sleep", "click twelve",
    "click five", "go back", "switch to tab two", "open youtube", "search youtube for lofi beats", "show flags",
    "hide the flags", "show the grid", "zoom in", "zoom out", "reload the page", "close this tab", "open a new tab",
    "stop", "scroll to the top", "scroll up", "pause the video", "mute the tab", "next tab", "previous tab",
    "read this page", "click subscribe", "click on sign in", "open canvas", "type hello world",
]


def phrases():
    root = Path(__file__).resolve().parents[2] / "bench"
    heard = [c["heard"] for c in json.loads((root / "router-cases.json").read_text())]
    # "Havi go to sleep" is itself a mishearing; the speaker said the name.
    heard = ["hey navi go to sleep" if h == "Havi go to sleep" else h for h in heard]
    tasks = [c for t in json.loads((root / "tasks.json").read_text()) for c in t["commands"] if "@" not in c]
    out = []
    for p in BUILT_INS + heard + tasks:
        if p not in out:
            out.append(p)
    return out


# The voices that speak the test set: many engines and speakers, so no recognizer is tuned to one voice.
VOICE_POOL = (
    [("Kokoro v1.0", sid) for sid in (3, 2, 6, 9, 16, 14, 18, 11, 21, 22, 26, 27)]
    + [("Supertonic 3", sid) for sid in range(10)]
    + [("Kitten nano 0.2", sid) for sid in range(8)]
    + [("Pocket TTS", ref) for ref in ("bria.wav", "loona.wav")]
    + [("Piper lessac", 0)]
)

NOISES = sorted(Path("noise").glob("*.wav"))


def mix(speech, noise_file, snr_db):
    noise, _ = sf.read(noise_file, dtype="float32")
    start = random.randint(0, max(0, len(noise) - len(speech) - 1))
    noise = np.resize(noise[start:], len(speech))
    p_s = np.mean(speech**2) + 1e-9
    p_n = np.mean(noise**2) + 1e-9
    out = speech + noise * np.sqrt(p_s / (p_n * 10 ** (snr_db / 10)))
    return np.clip(out, -1, 1)


def build():
    SET.mkdir(parents=True, exist_ok=True)
    items = []
    engines = {}
    for i, text in enumerate(phrases()):
        engine, voice = VOICE_POOL[i % len(VOICE_POOL)]
        if engine not in engines:
            builder, folder, _, extra = V.ENGINES[engine]
            engines[engine] = (V.make(builder, folder, 4), extra)
        tts, extra = engines[engine]
        a = tts.generate(text, V.gen_config(voice, extra))
        speech = np.asarray(a.samples, dtype=np.float32)
        # 16 kHz like a mic stream, with a short pause before and after.
        n = int(len(speech) * 16000 / a.sample_rate)
        speech = np.interp(np.linspace(0, len(speech) - 1, n), np.arange(len(speech)), speech).astype(np.float32)
        speech = np.concatenate([np.zeros(4000, np.float32), speech / (np.max(np.abs(speech)) + 1e-9) * 0.7, np.zeros(4000, np.float32)])
        base = f"{i:03d}"
        sf.write(SET / f"{base}-clean.wav", speech, 16000)
        sf.write(SET / f"{base}-babble10.wav", mix(speech, Path("noise/Babble_1.wav"), 10), 16000)
        other = random.choice([n for n in NOISES if "Babble" not in n.name])
        sf.write(SET / f"{base}-noise5.wav", mix(speech, other, 5), 16000)
        items.append({"id": base, "text": text, "voice": f"{engine}:{voice}", "noise5": other.stem})
    (SET / "manifest.json").write_text(json.dumps(items, indent=1))
    print(f"{len(items)} phrases x 3 conditions")


def recognizers():
    def d(name):
        return M / name

    p2, p3 = d("sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"), d("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
    q = d("sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25")
    mb, mt = d("sherpa-onnx-moonshine-base-en-quantized-2026-02-27"), d("sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27")
    c = d("sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8")
    nm = d("sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25")

    def transducer(folder):
        return lambda t: sherpa_onnx.OfflineRecognizer.from_transducer(
            str(folder / "encoder.int8.onnx"), str(folder / "decoder.int8.onnx"), str(folder / "joiner.int8.onnx"),
            str(folder / "tokens.txt"), num_threads=t, model_type="nemo_transducer",
        )

    def whisper(folder, prefix):
        return lambda t: sherpa_onnx.OfflineRecognizer.from_whisper(
            str(folder / f"{prefix}-encoder.int8.onnx"), str(folder / f"{prefix}-decoder.int8.onnx"),
            str(folder / f"{prefix}-tokens.txt"), language="en", num_threads=t,
        )

    return {
        "Parakeet TDT 0.6B v2": (transducer(p2), p2, False),
        "Parakeet TDT 0.6B v3": (transducer(p3), p3, False),
        "Qwen3-ASR 0.6B": (
            lambda t: sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
                conv_frontend=str(q / "conv_frontend.onnx"), encoder=str(q / "encoder.int8.onnx"),
                decoder=str(q / "decoder.int8.onnx"), tokenizer=str(q / "tokenizer"), num_threads=t,
            ),
            q, False,
        ),
        "Moonshine base (v2)": (
            lambda t: sherpa_onnx.OfflineRecognizer.from_moonshine_v2(
                encoder=str(mb / "encoder_model.ort"), decoder=str(mb / "decoder_model_merged.ort"),
                tokens=str(mb / "tokens.txt"), num_threads=t,
            ),
            mb, False,
        ),
        "Moonshine tiny (v2)": (
            lambda t: sherpa_onnx.OfflineRecognizer.from_moonshine_v2(
                encoder=str(mt / "encoder_model.ort"), decoder=str(mt / "decoder_model_merged.ort"),
                tokens=str(mt / "tokens.txt"), num_threads=t,
            ),
            mt, False,
        ),
        "Canary 180M flash": (
            lambda t: sherpa_onnx.OfflineRecognizer.from_nemo_canary(
                encoder=str(c / "encoder.int8.onnx"), decoder=str(c / "decoder.int8.onnx"), tokens=str(c / "tokens.txt"),
                src_lang="en", tgt_lang="en", num_threads=t,
            ),
            c, False,
        ),
        "Nemotron streaming 0.6B": (
            lambda t: sherpa_onnx.OnlineRecognizer.from_transducer(
                str(nm / "tokens.txt"), str(nm / "encoder.int8.onnx"), str(nm / "decoder.int8.onnx"),
                str(nm / "joiner.int8.onnx"), num_threads=t, model_type="nemo_transducer",
            ),
            nm, True,
        ),
        "Whisper small.en": (whisper(d("sherpa-onnx-whisper-small.en"), "small.en"), d("sherpa-onnx-whisper-small.en"), False),
        "Distil-Whisper large-v3.5": (
            whisper(d("sherpa-onnx-whisper-distil-large-v3.5"), "distil-large-v3.5"), d("sherpa-onnx-whisper-distil-large-v3.5"), False,
        ),
        "Whisper large-v3-turbo": (whisper(d("sherpa-onnx-whisper-turbo"), "turbo"), d("sherpa-onnx-whisper-turbo"), False),
    }


def transcribe(rec, streaming, audio):
    if streaming:
        s = rec.create_stream()
        s.accept_waveform(16000, audio)
        s.accept_waveform(16000, np.zeros(int(0.8 * 16000), np.float32))
        s.input_finished()
        while rec.is_ready(s):
            rec.decode_stream(s)
        return rec.get_result(s)
    s = rec.create_stream()
    s.accept_waveform(16000, audio)
    rec.decode_stream(s)
    return s.result.text


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def spell(n):
    n = int(n)
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + spell(n % 100))
    return str(n)


def norm(text):
    t = text.lower().replace("p.m.", "pm").replace("a.m.", "am").replace("-", " ")
    t = re.sub(r"(\d+):(\d\d)", lambda m: f"{m.group(1)} {m.group(2)}", t)
    t = re.sub(r"\d+", lambda m: f" {spell(m.group(0))} ", t)
    t = re.sub(r"[^a-z' ]+", " ", t)
    return " ".join(t.split())


def wer(ref, hyp):
    r, h = ref.split(), hyp.split()
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(h)], len(r)


def decode(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    items = json.loads((SET / "manifest.json").read_text())
    for name, (make, folder, streaming) in recognizers().items():
        if only and name not in only:
            continue
        if not folder.is_dir():
            print(f"skip {name}: not downloaded", file=sys.stderr)
            continue
        size = sum(p.stat().st_size for p in folder.rglob("*") if p.is_file() and "test_wavs" not in p.parts) / 1e6
        t0 = time.time()
        rec = make(4)
        load = time.time() - t0
        rows = []
        for it in items:
            for cond in ("clean", "babble10", "noise5"):
                audio, _ = sf.read(SET / f"{it['id']}-{cond}.wav", dtype="float32")
                t0 = time.time()
                hyp = transcribe(rec, streaming, audio)
                rows.append({"id": it["id"], "cond": cond, "ref": it["text"], "hyp": hyp.strip(), "ms": round((time.time() - t0) * 1000)})
        # Latency on one CPU thread (the browser without cross-origin isolation), on the clean set.
        rec1 = make(1)
        one = []
        for it in items[:30]:
            audio, _ = sf.read(SET / f"{it['id']}-clean.wav", dtype="float32")
            t0 = time.time()
            transcribe(rec1, streaming, audio)
            one.append((time.time() - t0, len(audio) / 16000))
        summary = {"model": name, "size_mb": round(size), "load_s": round(load, 1), "streaming": streaming}
        for cond in ("clean", "babble10", "noise5"):
            errs = words = exact = 0
            for r in rows:
                if r["cond"] != cond:
                    continue
                e, n = wer(norm(r["ref"]), norm(r["hyp"]))
                errs, words, exact = errs + e, words + n, exact + (e == 0)
            summary[f"wer_{cond}"] = round(100 * errs / words, 1)
            summary[f"exact_{cond}"] = round(100 * exact / len(items), 1)
        navi = [r for r in rows if "navi" in r["ref"].lower()]
        summary["navi_heard"] = f"{sum('navi' in norm(r['hyp']).split() for r in navi)}/{len(navi)}"
        summary["ms_per_command_1thread"] = round(1000 * float(np.median([t for t, _ in one])))
        summary["rtf_1thread"] = round(sum(t for t, _ in one) / sum(a for _, a in one), 3)
        print(json.dumps(summary))
        (OUT / f"{name}.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1))
        del rec, rec1


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    if sys.argv[1] == "build":
        build()
    else:
        decode(set(sys.argv[2:]) or None)
