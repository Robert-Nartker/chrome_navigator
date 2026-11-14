"""Whisper small.en with an optional text prompt (Navi's commands, as earlier context), decoded greedily.

sherpa-onnx can't give Whisper a prompt, so this runs its exported encoder and decoder directly
(onnxruntime) with the prompt put before the start of the transcript, the way Whisper's own
"initial prompt" works: [<|startofprev|>, prompt…, <|startoftranscript|>, <|notimestamps|>].

  python3 whisper_prompt.py MODEL_DIR CLIPS_DIR OUT.json [--prompt TEXT] [--limit N]

Writes the same JSON as transcribe.py, so score.mjs scores it.
"""

import argparse
import base64
import json
import os
import re
import sys
import time

import kaldi_native_fbank as knf
import numpy as np
import onnxruntime as ort
import soundfile as sf


def load_tokens(path):
    """Whisper's byte-level BPE: one base64 token per line, its line number being its merge rank."""
    ranks = {}
    with open(path) as f:
        for line in f:
            b64, idx = line.split()
            ranks[base64.b64decode(b64)] = int(idx)
    return ranks


PRETOKEN = re.compile(r"'s|'t|'re|'ve|'m|'ll|'d| ?[A-Za-z]+| ?[0-9]+| ?[^\sA-Za-z0-9]+|\s+(?!\S)|\s+")


def bpe(piece, ranks):
    parts = [bytes([b]) for b in piece]
    while len(parts) > 1:
        best = None
        for i in range(len(parts) - 1):
            r = ranks.get(parts[i] + parts[i + 1])
            if r is not None and (best is None or r < best[0]):
                best = (r, i)
        if best is None:
            break
        i = best[1]
        parts = parts[:i] + [parts[i] + parts[i + 1]] + parts[i + 2:]
    return [ranks[p] for p in parts]


def encode(text, ranks):
    ids = []
    for piece in PRETOKEN.findall(text):
        ids += bpe(piece.encode(), ranks)
    return ids


def features(samples):
    opts = knf.WhisperFeatureOptions()
    opts.dim = 80
    fb = knf.OnlineWhisperFbank(opts)
    fb.accept_waveform(16000, samples)
    fb.input_finished()
    mel = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)])
    log_spec = np.log10(np.clip(mel, 1e-10, None))
    log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
    mel = (log_spec + 4.0) / 4.0
    # Padding after the speech, so the model sees silence and ends the transcript (as sherpa-onnx does).
    mel = np.pad(mel, ((0, 1500), (0, 0)))
    if mel.shape[0] > 3000:
        mel = np.pad(mel[: 3000 - 50], ((0, 50), (0, 0)))
    return mel.T[None].astype(np.float32)


class Whisper:
    def __init__(self, model_dir):
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 4
        self.enc = ort.InferenceSession(os.path.join(model_dir, "small.en-encoder.int8.onnx"), opts)
        self.dec = ort.InferenceSession(os.path.join(model_dir, "small.en-decoder.int8.onnx"), opts)
        meta = self.enc.get_modelmeta().custom_metadata_map
        self.meta = {k: meta[k] for k in meta}
        self.ranks = load_tokens(os.path.join(model_dir, "small.en-tokens.txt"))
        self.id_to_bytes = {v: k for k, v in self.ranks.items()}
        self.eot = int(meta["eot"])
        self.sot = int(meta["sot"])
        self.sot_prev = int(meta["sot_prev"])
        self.no_ts = int(meta["no_timestamps"])
        self.blank = int(meta["blank_id"])
        self.n_layer = int(meta["n_text_layer"])
        self.n_ctx = int(meta["n_text_ctx"])
        self.n_state = int(meta["n_text_state"])
        self.suppress = [int(x) for x in meta["non_speech_tokens"].split(",")]

    def transcribe(self, samples, prompt_ids=()):
        cross_k, cross_v = self.enc.run(None, {"mel": features(samples)})
        k = np.zeros((self.n_layer, 1, self.n_ctx, self.n_state), np.float32)
        v = np.zeros_like(k)
        start = ([self.sot_prev, *prompt_ids] if prompt_ids else []) + [self.sot, self.no_ts]
        tokens = np.array([start], np.int64)
        offset = np.zeros(1, np.int64)
        out = []
        for step in range(60):
            logits, k, v = self.dec.run(None, {
                "tokens": tokens, "in_n_layer_self_k_cache": k, "in_n_layer_self_v_cache": v,
                "n_layer_cross_k": cross_k, "n_layer_cross_v": cross_v, "offset": offset,
            })
            offset = offset + tokens.shape[1]
            logits = logits[0, -1].astype(np.float64)
            logits[self.suppress] = -np.inf
            logits[self.eot + 1:] = -np.inf  # special tokens
            if step == 0:
                logits[[self.blank, self.eot]] = -np.inf
            nxt = int(logits.argmax())
            if nxt == self.eot:
                break
            out.append(nxt)
            tokens = np.array([[nxt]], np.int64)
        return b"".join(self.id_to_bytes.get(t, b"") for t in out).decode("utf-8", "replace").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir")
    ap.add_argument("clips")
    ap.add_argument("out")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--name", default="")
    a = ap.parse_args()
    w = Whisper(a.model_dir)
    prompt_ids = encode(" " + a.prompt.strip(), w.ranks) if a.prompt else []
    index = json.load(open(os.path.join(a.clips, "index.json")))
    if a.limit:
        index = index[: a.limit]
    results, audio_s, t0 = [], 0.0, time.time()
    for i, clip in enumerate(index):
        samples, sr = sf.read(os.path.join(a.clips, clip["file"]), dtype="float32")
        assert sr == 16000, sr
        audio_s += len(samples) / sr
        results.append({**clip, "heard": w.transcribe(samples, prompt_ids)})
        if i % 50 == 0:
            print(i, clip.get("file"), repr(results[-1]["heard"]), file=sys.stderr, flush=True)
    name = a.name or ("whisper-small-prompt" if a.prompt else "whisper-small-onnx")
    json.dump({"model": name, "clips": a.clips, "seconds": time.time() - t0, "audio_seconds": audio_s,
               "prompt": a.prompt, "results": results}, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
