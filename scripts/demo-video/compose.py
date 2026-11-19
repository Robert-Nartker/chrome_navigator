"""Builds the demo video from the screen recording (a real Chromium window with Navi in its side panel):

- a title card, the recording and an end card, joined with crossfades;
- the AI's thinking time sped up 6x (with a small badge), so nothing waits on screen;
- short text cards in place of a narrator, fading in over the recording;
- the user's commands and what Navi says aloud, each labelled ("YOU", "NAVI"), in their own voices, and
  Navi's chimes where it played them (with the panel open, actions get a chime and only answers are spoken).

Usage: python3 scripts/demo-video/compose.py <script.json> <out dir>   (writes <out dir>/navi-demo.mp4)
"""
import json, subprocess, sys, textwrap
import numpy as np
import soundfile as sf

script_file, out = sys.argv[1:3]
script = json.load(open(script_file))
rec = json.load(open(f"{out}/events.json"))
speech = f"{out}/speech"
durations = json.load(open(f"{speech}/durations.json"))
durations.update(json.load(open(f"{speech}/durations-replies.json")))
BOLD = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
SEMI = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
REG = "/usr/share/fonts/opentype/inter/Inter-Regular.otf"
W, H = 1920, 1080
BG = "0x111018"
ACCENT = "0x8f8bff"
NAVI = "0xc7c4ff"
PAGE_W = 1540  # the page's part of the window; Navi's side panel takes the right
SPEED = 6
FADE = 0.5

def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")

events = rec["events"]
start = 0.6
end = next(e["t"] for e in events if e["kind"] == "end")

# The AI's thinking time: from just after a command to just before its reply shows, when that's long.
says = [e for e in events if e["kind"] == "say"]
replies = [e for e in events if e["kind"] == "reply"]
# A line said faster than recorded ("speed" in script.json): it ends where it did, so what follows still
# follows it, and it starts that much later.
steps = script["steps"]
for s in says:
    speed = steps[int(s["key"][1:])].get("speed", 1.0)
    if speed != 1.0:
        before = s.get("duration", durations.get(s["key"], 1.5))
        faster = f"{speech}/{s['key']}-x{speed}.wav"
        run(["-i", f"{speech}/{s['key']}.wav", "-af", f"atempo={speed}", faster])
        s["file"], s["duration"] = faster, before / speed
        s["t"] += before - before / speed

cards = [(e["t"], e["t"] + 3.2) for e in events if e["kind"] == "card"]
ai_waits = []
for i, s in enumerate(says):
    said_end = s["t"] + s.get("duration", durations.get(s["key"], 1.5))
    # Its own reply, before anything else is said ("stop" has none: the next command's isn't its).
    next_say = says[i + 1]["t"] if i + 1 < len(says) else end
    nxt = next((r for r in replies if said_end < r["t"] < next_say), None)
    if nxt and nxt["t"] - said_end > 3.0:
        a, b = said_end + 0.9, nxt["t"] - 0.6
        # Never over a card: it has to stay up long enough to read.
        for ca, cb in cards:
            if ca < b and cb > a:
                a, b = (cb, b) if ca <= a else (a, ca)
        if b - a > 1.0:
            ai_waits.append((a, b))

# Dead air: moments with nothing said, shown or happening (a page loading, a pause between commands) are
# sped through, so the video never seems to wait.
CARD_S = 3.2
DEAD_SPEED = 5
busy = list(ai_waits)
for s in says:
    busy.append((s["t"] - 0.2, s["t"] + s.get("duration", durations.get(s["key"], 1.5)) + 0.45))
for i, e in enumerate(e for e in events if e["kind"] == "navi"):
    nxt = next((s["t"] for s in says if s["t"] > e["t"]), end)
    busy.append((e["t"], min(e["t"] + durations.get(f"navi-{i}", 2.0) + 0.3, nxt)))
for e in events:
    if e["kind"] == "card":
        busy.append((e["t"], e["t"] + CARD_S))
    elif e["kind"] in ("reply", "sound"):
        busy.append((e["t"] - 0.15, e["t"] + 0.8))
busy.sort()
merged = []
for a, b in busy:
    if merged and a <= merged[-1][1]:
        merged[-1] = (merged[-1][0], max(merged[-1][1], b))
    else:
        merged.append((a, b))
dead, cur = [], start
for a, b in merged + [(end, end)]:
    if a - cur > 0.9:
        dead.append((cur + 0.25, a - 0.25))
    cur = max(cur, b)
# (start, end, speed, badge)
regions = sorted([(a, b, SPEED, True) for a, b in ai_waits] + [(a, b, DEAD_SPEED, False) for a, b in dead])

def out_time(t):
    """Where a moment of the recording lands in the edited recording."""
    t = max(start, min(end, t))
    out_t, cur = 0.0, start
    for a, b, speed, _ in regions:
        if t <= a:
            break
        out_t += a - cur
        if t <= b:
            return out_t + (t - a) / speed
        out_t += (b - a) / speed
        cur = b
    return out_t + (t - cur)

main_len = out_time(end)

# Cards.
title_len, end_len = 2.8, 5.0
t = script["title"]
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={title_len}:r=30",
     "-vf", ",".join([
         f"drawtext=fontfile={BOLD}:text='{esc(t['heading'])}':fontsize=170:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-70",
         f"drawtext=fontfile={REG}:text='{esc(t['sub'])}':fontsize=52:fontcolor={ACCENT}:x=(w-tw)/2:y=h/2+80",
         "fade=t=in:st=0:d=0.4", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "18", f"{out}/title.mp4"])
e = script["end"]
draws = [f"drawtext=fontfile={BOLD}:text='{esc(e['heading'])}':fontsize=140:fontcolor=white:x=(w-tw)/2:y=250"]
for i, line in enumerate(e["lines"]):
    font, color = (SEMI, ACCENT) if "github" in line else (REG, "0xe4e2ff")
    draws.append(f"drawtext=fontfile={font}:text='{esc(line)}':fontsize=44:fontcolor={color}:x=(w-tw)/2:y={500 + i * 86}")
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={end_len}:r=30", "-vf", ",".join(draws + ["format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "18", f"{out}/end.mp4"])

# Overlays on the edited recording, in its own time.
def fading(a, b, fade=0.25):
    return f"alpha='if(lt(t,{a:.2f}),0,if(lt(t,{a + fade:.2f}),(t-{a:.2f})/{fade},if(lt(t,{b - fade:.2f}),1,if(lt(t,{b:.2f}),({b:.2f}-t)/{fade},0))))'"

overlays = []
def label(text, color, a, b, y):
    overlays.append(f"drawtext=fontfile={BOLD}:text='{text}':fontsize=24:fontcolor=0x111018:box=1:boxcolor={color}:boxborderw=11:x=56:y={y}:{fading(a, b)}")

def caption(lines, a, b, y0, color="white"):
    for li, line in enumerate(lines):
        overlays.append(f"drawtext=fontfile={SEMI}:text='{esc(line)}':fontsize=36:fontcolor={color}:box=1:boxcolor=0x111018@0.92:boxborderw=18:x=56:y={y0 + li * 58}:{fading(a, b)}")

# Above Navi's own caption on the page (bottom centre), so the two never overlap.
BASE = H - 270
timed = sorted([e for e in events if e["kind"] in ("say", "navi")], key=lambda e: e["t"])
for i, ev in enumerate(timed):
    a = out_time(ev["t"])
    nxt = out_time(timed[i + 1]["t"]) if i + 1 < len(timed) else main_len
    if ev["kind"] == "say":
        b = min(nxt, a + ev.get("duration", durations.get(ev["key"], 1.5)) + 1.3)
        label("YOU", ACCENT, a, b, BASE - 55)
        caption([f"“{ev['text']}”"], a, b, BASE)
    else:
        b = min(nxt, a + 6.0)
        lines = textwrap.wrap(ev["text"], 58)
        if len(lines) > 2:
            lines = lines[:2]
            lines[1] = lines[1].rstrip(" ,.;:") + "…"
        label("NAVI", NAVI, a, b, BASE - 55 - 58 * (len(lines) - 1))
        caption(lines, a, b, BASE - 58 * (len(lines) - 1), color="0xece9ff")

for ev in events:
    if ev["kind"] == "card":
        a = out_time(ev["t"])
        b = out_time(ev["t"] + CARD_S)
        # Hard to miss: the page dims behind a band across its middle, with the words large on it.
        on = f"enable='between(t,{a:.2f},{b:.2f})'"
        overlays.append(f"drawbox=x=0:y=86:w={PAGE_W}:h={H - 86}:color=black@0.45:t=fill:{on}")
        overlays.append(f"drawbox=x=0:y=430:w={PAGE_W}:h=150:color=0x1d1a33@0.97:t=fill:{on}")
        overlays.append(f"drawbox=x=0:y=430:w={PAGE_W}:h=5:color={ACCENT}:t=fill:{on}")
        overlays.append(f"drawbox=x=0:y=575:w={PAGE_W}:h=5:color={ACCENT}:t=fill:{on}")
        overlays.append(f"drawtext=fontfile={SEMI}:text='{esc(ev['text'])}':fontsize=50:fontcolor=white:x=({PAGE_W}-tw)/2:y=505-th/2:{fading(a, b, 0.2)}")

for a, b, _, badge in regions:
    if not badge:
        continue
    oa, ob = out_time(a), out_time(b)
    overlays.append(f"drawtext=fontfile={BOLD}:text='AI working  ·  {SPEED}×':fontsize=26:fontcolor=0x111018:box=1:boxcolor={NAVI}:boxborderw=12:x={PAGE_W}-tw-60:y=104:enable='between(t,{oa:.2f},{ob:.2f})'")

# The recording, cut: normal speed, the AI's thinking sped up, normal again.
segments, cur = [], start
for a, b, speed, _ in regions:
    segments.append((cur, a, 1))
    segments.append((a, b, speed))
    cur = b
segments.append((cur, end, 1))
segments = [seg for seg in segments if seg[1] - seg[0] > 0.04]
parts = [f"[0:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{speed}[v{i}]" for i, (a, b, speed) in enumerate(segments)]
parts.append("".join(f"[v{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=1:a=0,fps=30,{','.join(overlays)},format=yuv420p[v]")
run(["-i", rec["screen"], "-filter_complex", ";".join(parts), "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "18", f"{out}/main.mp4"])

# Navi's chimes, as Navi plays them (voice-output.ts: sine tones with a quick fade).
TONES = {"done": [(1175, 0, 0.08, 0.05)], "wake": [(660, 0, 0.12, 0.08), (990, 0.09, 0.16, 0.08)],
         "unknown": [(523, 0, 0.09, 0.05), (440, 0.08, 0.12, 0.05)], "error": [(330, 0, 0.12, 0.07), (262, 0.1, 0.16, 0.07)],
         "sleep": [(880, 0, 0.12, 0.08), (587, 0.09, 0.18, 0.08)], "notify": [(1047, 0, 0.1, 0.04), (1319, 0.11, 0.16, 0.04)]}
for name, tones in TONES.items():
    sr = 48000
    x = np.zeros(int(sr * 0.5), np.float32)
    for freq, at, dur, level in tones:
        n = int(sr * dur)
        tt = np.arange(n) / sr
        env = np.minimum(tt / 0.015, 1) * np.exp(np.log(0.0001 / 1) * tt / dur)
        s0 = int(sr * at)
        x[s0:s0 + n] += (level * 4 * env * np.sin(2 * np.pi * freq * tt)).astype(np.float32)
    sf.write(f"{speech}/chime-{name}.wav", x, sr)

# The sound, on the final timeline (the recording starts as the title fades out).
main_at = title_len - FADE
total = title_len + main_len + end_len - 2 * FADE
clips = []
navi_i = 0
for i, ev in enumerate(timed):
    at = main_at + out_time(ev["t"])
    if ev["kind"] == "say":
        clips.append((ev.get("file", f"{speech}/{ev['key']}.wav"), at, None, 1.0))
    else:
        nxt = next((s["t"] for s in says if s["t"] > ev["t"] + 0.05), None)
        limit = min(6.0, (out_time(nxt) - out_time(ev["t"]) - 0.1) if nxt else 8.0)
        clips.append((f"{speech}/navi-{navi_i}.wav", at + 0.05, max(0.5, limit), 1.0))
        navi_i += 1
for ev in events:
    if ev["kind"] == "sound" and ev["text"] in TONES:
        clips.append((f"{speech}/chime-{ev['text']}.wav", main_at + out_time(ev["t"]), None, 0.7))
inputs, mix = [], []
for i, (file, at, limit, gain) in enumerate(clips):
    inputs += ["-i", file]
    ms = int(max(0, at) * 1000)
    cut = f",atrim=duration={limit:.2f},afade=t=out:st={max(0, limit - 0.25):.2f}:d=0.25" if limit else ""
    mix.append(f"[{i}:a]aresample=48000,volume={gain}{cut},adelay={ms}|{ms}[a{i}]")
mix.append("".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0:duration=longest,apad,atrim=duration={total:.2f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
run([*inputs, "-filter_complex", ";".join(mix), "-map", "[aout]", "-ac", "2", "-c:a", "pcm_s16le", f"{out}/voices.wav"])

run(["-i", f"{out}/title.mp4", "-i", f"{out}/main.mp4", "-i", f"{out}/end.mp4", "-i", f"{out}/voices.wav",
     "-filter_complex",
     f"[0:v][1:v]xfade=transition=fade:duration={FADE}:offset={title_len - FADE:.2f}[x];"
     f"[x][2:v]xfade=transition=fade:duration={FADE}:offset={title_len + main_len - 2 * FADE:.2f},format=yuv420p[v]",
     "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
     "-shortest", "-movflags", "+faststart", f"{out}/navi-demo.mp4"])
print(f"navi-demo.mp4: {total:.1f} s; {len(ai_waits)} AI waits and {len(dead)} pauses sped up")
