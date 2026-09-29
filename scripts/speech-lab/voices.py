# Speech lab, part 1: on-device voices (sherpa-onnx builds, run natively on the CPU). Run fetch.sh first.
# Writes MP3 samples of Navi-style replies, and speed numbers, to out/voices/.
import json
import os
import re
import sys
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
import soundfile as sf

M = Path("models")
OUT = Path("out/voices")
OUT.mkdir(parents=True, exist_ok=True)

REPLIES = [
    "Hi, I'm Navi. You have three new emails. The newest is from Sarah, about moving Friday's meeting to 3:30.",
    "Done. I subscribed to AI Explained and started the Transformers video.",
    "The cheapest flight to Denver is $129 on United, leaving at 7:10 tomorrow morning. Want me to open it?",
]


def model(**kw):
    return sherpa_onnx.OfflineTtsModelConfig(provider="cpu", debug=False, **kw)


def kokoro(d, threads):
    d = M / d
    return model(
        kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(d / "model.onnx"), voices=str(d / "voices.bin"), tokens=str(d / "tokens.txt"),
            data_dir=str(d / "espeak-ng-data"), lexicon=f"{d / 'lexicon-us-en.txt'}",
        ),
        num_threads=threads,
    )


def kitten(d, threads):
    d = M / d
    return model(
        kitten=sherpa_onnx.OfflineTtsKittenModelConfig(
            model=str(next(d.glob("model*.onnx"))), voices=str(d / "voices.bin"), tokens=str(d / "tokens.txt"),
            data_dir=str(d / "espeak-ng-data"),
        ),
        num_threads=threads,
    )


def piper(d, threads):
    d = M / d
    return model(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(next(d.glob("*.onnx"))), tokens=str(d / "tokens.txt"), data_dir=str(d / "espeak-ng-data"),
        ),
        num_threads=threads,
    )


def pocket(d, threads):
    d = M / d
    return model(
        pocket=sherpa_onnx.OfflineTtsPocketModelConfig(
            lm_flow=str(d / "lm_flow.int8.onnx"), lm_main=str(d / "lm_main.int8.onnx"),
            encoder=str(d / "encoder.onnx"), decoder=str(d / "decoder.int8.onnx"),
            text_conditioner=str(d / "text_conditioner.onnx"), vocab_json=str(d / "vocab.json"),
            token_scores_json=str(d / "token_scores.json"),
        ),
        num_threads=threads,
    )


def supertonic(d, threads):
    d = M / d
    return model(
        supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=str(d / "duration_predictor.int8.onnx"), text_encoder=str(d / "text_encoder.int8.onnx"),
            vector_estimator=str(d / "vector_estimator.int8.onnx"), vocoder=str(d / "vocoder.int8.onnx"),
            tts_json=str(d / "tts.json"), unicode_indexer=str(d / "unicode_indexer.bin"), voice_style=str(d / "voice.bin"),
        ),
        num_threads=threads,
    )


POCKET_DIR = "sherpa-onnx-pocket-tts-int8-2026-01-26"

# name -> (builder, folder, {voice label: sid or reference wav}, extra generation settings)
ENGINES = {
    "Kokoro v1.0": (kokoro, "kokoro-multi-lang-v1_0", {"Heart (af_heart)": 3, "Bella (af_bella)": 2, "Michael (am_michael)": 16, "Emma (bf_emma)": 21}, {}),
    "Pocket TTS": (pocket, POCKET_DIR, {"Bria": "bria.wav", "Loona": "loona.wav"}, {"num_steps": 5}),
    "Supertonic 3": (supertonic, "sherpa-onnx-supertonic-3-tts-int8-2026-05-11", {"Voice 6": 6, "Voice 1": 1}, {"num_steps": 5, "lang": "en"}),
    "Kitten mini 0.1": (kitten, "kitten-mini-en-v0_1-fp16", {"Voice 2 (f)": 1, "Voice 3 (m)": 2}, {}),
    "Kitten nano 0.2": (kitten, "kitten-nano-en-v0_2-fp16", {"Voice 2 (f)": 1}, {}),
    "Piper lessac": (piper, "vits-piper-en_US-lessac-medium", {"Lessac": 0}, {}),
}


def speakable(text):
    """What Navi's Kokoro (kokoro-js) reads: "$129" as "129 dollars", "3:30" as "3 30"."""
    def money(m):
        dollars, cents = m.group(1), m.group(2)
        out = f"{dollars} dollar{'' if dollars == '1' else 's'}"
        return out + (f" and {int(cents)} cents" if cents else "")

    def clock(m):
        h, mm = m.group(1), int(m.group(2))
        return f"{h} o'clock" if mm == 0 else f"{h} oh {mm}" if mm < 10 else f"{h} {mm}"

    text = re.sub(r"\$(\d+)(?:\.(\d\d))?", money, text)
    return re.sub(r"\b(1[0-2]|[1-9]):([0-5]\d)\b", clock, text)


def gen_config(voice, extra):
    g = sherpa_onnx.GenerationConfig()
    if isinstance(voice, str):
        ref, sr = sf.read(M / POCKET_DIR / "test_wavs" / voice, dtype="float32", always_2d=True)
        g.reference_audio = ref[:, 0]
        g.reference_sample_rate = sr
    else:
        g.sid = voice
    for k, v in extra.items():
        if k == "lang":
            g.extra["lang"] = v
        else:
            setattr(g, k, v)
    return g


def make(builder, folder, threads):
    cfg = sherpa_onnx.OfflineTtsConfig(model=builder(folder, threads), max_num_sentences=1)
    if not cfg.validate():
        raise ValueError(f"bad config for {folder}")
    return sherpa_onnx.OfflineTts(cfg)


def size_mb(folder):
    return sum(p.stat().st_size for p in (M / folder).rglob("*") if p.is_file() and "espeak" not in str(p) and "dict" not in p.parts) / 1e6


def main(only=None):
    results = []
    for name, (builder, folder, voices, extra) in ENGINES.items():
        if only and name not in only:
            continue
        if not (M / folder).is_dir():
            print(f"skip {name}: not downloaded", file=sys.stderr)
            continue
        slug = name.lower().replace(" ", "-").replace(".", "")
        row = {"engine": name, "folder": folder, "size_mb": round(size_mb(folder)), "samples": []}
        for threads in (1, 4):
            t0 = time.time()
            tts = make(builder, folder, threads)
            load = time.time() - t0
            first_voice = next(iter(voices.values()))
            g = gen_config(first_voice, extra)
            tts.generate("Warm up.", g)
            synth = audio = 0.0
            first_sentence = []
            texts = [speakable(t) for t in REPLIES] if builder is kokoro else REPLIES
            for text in texts:
                first = text.split(". ")[0] + "."
                t0 = time.time()
                a = tts.generate(first, g)
                first_sentence.append(time.time() - t0)
                t0 = time.time()
                a = tts.generate(text, g)
                synth += time.time() - t0
                audio += len(a.samples) / a.sample_rate
            row[f"threads{threads}"] = {
                "load_s": round(load, 2),
                "rtf": round(synth / audio, 3),
                "first_sentence_s": round(float(np.median(first_sentence)), 2),
            }
            if threads == 4:
                for label, voice in voices.items():
                    g = gen_config(voice, extra)
                    for i, text in enumerate(texts):
                        a = tts.generate(text, g)
                        samples = np.clip(np.asarray(a.samples, dtype=np.float32), -1, 1)
                        path = OUT / f"{slug}--{re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')}--{i + 1}.mp3"
                        sf.write(path, samples, a.sample_rate, format="MP3", subtype="MPEG_LAYER_III")
                        row["samples"].append({"voice": label, "reply": i + 1, "file": path.name})
            del tts
        print(json.dumps({k: v for k, v in row.items() if k != "samples"}))
        results.append(row)
    old = json.loads((OUT / "results.json").read_text()) if (OUT / "results.json").exists() else []
    merged = {r["engine"]: r for r in old}
    merged.update({r["engine"]: r for r in results})
    (OUT / "results.json").write_text(json.dumps(list(merged.values()), indent=1))


if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    main(set(sys.argv[1:]) or None)
