"""Turns clean 16 kHz clips into what a recognizer gets through a Bluetooth headset's mic.

Usage: python3 bench/asr/degrade.py <clean dir> <out root> [noise wav dir]

Conditions (each a folder of 16 kHz WAVs, as the browser hands them to the recognizer):
  clean       the clip as synthesized
  msbc        Bluetooth wideband speech (mSBC): 16 kHz, band-limited to ~7 kHz, coarse quantization, 1% lost packets
  cvsd        Bluetooth narrowband (CVSD, what Windows often uses with AirPods): 8 kHz, 300-3400 Hz phone band,
              8-bit companding, delta-modulation hiss, 2% lost packets, then back up to 16 kHz
  cvsd_noise  cvsd with room noise (a fan, a tap, dishes) at 10 dB SNR before the codec
  quiet       speech 18 dB quieter (a soft voice, a mic farther away), with mic self-noise
  cvsd_quiet  quiet through the narrowband headset codec
"""
import json, os, sys, random
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

clean_dir, root = sys.argv[1:3]
noise_dir = sys.argv[3] if len(sys.argv) > 3 else None
rng = np.random.default_rng(11)
SR = 16000

def bandpass(x, lo, hi, sr):
    sos = butter(6, [lo, hi], btype="band", fs=sr, output="sos")
    return sosfilt(sos, x)

def mulaw(x, bits=8):
    mu = 2 ** bits - 1
    y = np.sign(x) * np.log1p(mu * np.abs(x)) / np.log1p(mu)
    y = np.round((y + 1) / 2 * mu) / mu * 2 - 1
    return np.sign(y) * (np.expm1(np.abs(y) * np.log1p(mu)) / mu)

def lose_packets(x, sr, frame_ms, rate):
    """Lost packets, concealed by repeating the previous frame (what headsets do)."""
    n = int(sr * frame_ms / 1000)
    y = x.copy()
    for start in range(n, len(y) - n, n):
        if rng.random() < rate:
            y[start:start + n] = y[start - n:start]
    return y

def rms(x):
    return float(np.sqrt(np.mean(x ** 2)) + 1e-12)

def msbc(x):
    y = bandpass(x, 100, 7000, SR)
    y = np.round(y * 2048) / 2048  # coarse (about 12-bit) quantization
    return lose_packets(y, SR, 7.5, 0.01)

def cvsd(x):
    n8 = resample_poly(x, 1, 2)
    n8 = bandpass(n8, 300, 3400, 8000)
    n8 = mulaw(np.clip(n8 * 1.5, -1, 1)) / 1.5
    # Delta modulation's granular hiss, about 28 dB under the speech.
    n8 = n8 + rng.normal(0, rms(n8) * 10 ** (-28 / 20), len(n8))
    n8 = lose_packets(n8, 8000, 7.5, 0.02)
    return resample_poly(n8, 2, 1)

noises = []
if noise_dir and os.path.isdir(noise_dir):
    for f in sorted(os.listdir(noise_dir)):
        if f.endswith(".wav") and "white" not in f and "pink" not in f:
            a, sr = sf.read(f"{noise_dir}/{f}", dtype="float32")
            if sr != SR:
                a = resample_poly(a, SR, sr)
            noises.append(a)
if not noises:
    # Brown-ish noise, like a fan.
    noises = [np.cumsum(rng.normal(0, 1, SR * 30)).astype(np.float32)]
    noises[0] = noises[0] - np.convolve(noises[0], np.ones(400) / 400, "same")

def with_noise(x, snr_db):
    n = noises[rng.integers(len(noises))]
    start = rng.integers(0, max(1, len(n) - len(x)))
    seg = n[start:start + len(x)]
    if len(seg) < len(x):
        seg = np.pad(seg, (0, len(x) - len(seg)))
    speech = x[np.abs(x) > 0.01 * np.max(np.abs(x))]
    gain = rms(speech) / rms(seg) * 10 ** (-snr_db / 20)
    return x + seg * gain

def quiet(x):
    return x * 10 ** (-18 / 20) + rng.normal(0, 10 ** (-62 / 20), len(x))

conditions = {
    "clean": lambda x: x,
    "msbc": msbc,
    "cvsd": cvsd,
    "cvsd_noise": lambda x: cvsd(with_noise(x, 10)),
    "quiet": quiet,
    "cvsd_quiet": lambda x: cvsd(quiet(x)),
}
wanted = os.environ.get("CONDITIONS", ",".join(conditions)).split(",")
index = json.load(open(f"{clean_dir}/index.json"))
for name in wanted:
    out = f"{root}/{name}"
    os.makedirs(out, exist_ok=True)
    for item in index:
        x, sr = sf.read(f"{clean_dir}/{item['file']}", dtype="float32")
        y = np.clip(conditions[name](x.astype(np.float64)), -1, 1).astype(np.float32)
        sf.write(f"{out}/{item['file']}", y, SR, subtype="PCM_16")
    json.dump(index, open(f"{out}/index.json", "w"))
    print(name, len(index), flush=True)
