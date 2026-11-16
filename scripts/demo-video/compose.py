"""Builds the demo video: a title card, the screen recording (a real Chromium window with Navi in its side
panel), and an end card. The narrator, the user's commands and Navi's replies are laid in at the moments
they happened, each in its own voice, and labelled on screen: "Narrator" and "You" captions (Navi's
words already show in its panel and its caption on the page).

Usage: python3 scripts/demo-video/compose.py <script.json> <out dir>   (writes <out dir>/navi-demo.mp4)
"""
import json, subprocess, sys, textwrap

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
# The page's part of the window (Navi's side panel takes the right).
PAGE_W = 1540

def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")

events = rec["events"]
start = 0.6
end = next(e["t"] for e in events if e["kind"] == "end")
main_len = end - start
title_len = durations["title"] + 1.2
end_len = durations["end"] + 1.8

# Cards: dark, like the recording.
t = script["title"]
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={title_len}:r=30",
     "-vf", ",".join([
         f"drawtext=fontfile={BOLD}:text='{esc(t['heading'])}':fontsize=180:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-90",
         f"drawtext=fontfile={REG}:text='{esc(t['sub'])}':fontsize=54:fontcolor={ACCENT}:x=(w-tw)/2:y=(h)/2+90",
         "fade=t=in:st=0:d=0.5", f"fade=t=out:st={title_len - 0.4}:d=0.4", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/title.mp4"])
e = script["end"]
draws = [f"drawtext=fontfile={BOLD}:text='{esc(e['heading'])}':fontsize=140:fontcolor=white:x=(w-tw)/2:y=250"]
for i, line in enumerate(e["lines"]):
    font, color = (SEMI, ACCENT) if "github" in line else (REG, "0xe4e2ff")
    draws.append(f"drawtext=fontfile={font}:text='{esc(line)}':fontsize=46:fontcolor={color}:x=(w-tw)/2:y={500 + i * 90}")
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={end_len}:r=30",
     "-vf", ",".join(draws + ["fade=t=in:st=0:d=0.5", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/end.mp4"])

# Who's talking, on screen: the user's commands at the bottom left of the page, the narrator at the top.
captions = []
narrator_text = {}
for si, scene in enumerate(script["scenes"]):
    for ti, step in enumerate(scene["steps"]):
        if "narrator" in step:
            narrator_text[f"s{si}-{ti}-narrator"] = step["narrator"]
for ev in events:
    if ev["kind"] == "say":
        a = ev["t"] - start
        b = a + durations[ev["key"]] + 1.4
        enable = f"enable='between(t,{a:.2f},{b:.2f})'"
        captions.append(f"drawtext=fontfile={BOLD}:text='YOU':fontsize=26:fontcolor=0x111018:box=1:boxcolor={ACCENT}:boxborderw=12:x=60:y=h-205:{enable}")
        captions.append(f"drawtext=fontfile={SEMI}:text='“{esc(ev['text'])}”':fontsize=44:fontcolor=white:box=1:boxcolor=0x111018@0.9:boxborderw=22:x=60:y=h-150:{enable}")
    elif ev["kind"] == "narrator":
        a = ev["t"] - start
        b = a + durations[ev["key"]] + 0.3
        enable = f"enable='between(t,{a:.2f},{b:.2f})'"
        lines = textwrap.wrap(narrator_text[ev["key"]], 52)
        captions.append(f"drawtext=fontfile={BOLD}:text='NARRATOR':fontsize=24:fontcolor=0x111018:box=1:boxcolor=0xd8d6ff:boxborderw=12:x=({PAGE_W}-tw)/2:y=112:{enable}")
        for li, line in enumerate(lines):
            captions.append(f"drawtext=fontfile={SEMI}:text='{esc(line)}':fontsize=40:fontcolor=white:box=1:boxcolor=0x111018@0.92:boxborderw=18:x=({PAGE_W}-tw)/2:y={168 + li * 64}:{enable}")
run(["-ss", f"{start:.3f}", "-t", f"{main_len:.3f}", "-i", rec["screen"], "-vf", ",".join(captions + ["fps=30", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/main.mp4"])

# The voices on the final timeline. Navi's reply plays until the user's next command (talking over Navi
# stops it), and at most 7 seconds.
says = [ev["t"] for ev in events if ev["kind"] == "say"]
clips = [("title", 0.4, None)]
replies = 0
for ev in events:
    at = title_len + ev["t"] - start
    if ev["kind"] in ("narrator", "say"):
        clips.append((ev["key"], at, None))
    elif ev["kind"] == "navi":
        nxt = next((s for s in says if s > ev["t"] + 0.05), None)
        limit = min(6.0, (nxt - ev["t"]) if nxt else 8.0)
        clips.append((f"navi-{replies}", at + 0.1, max(0.5, limit - 0.15)))
        replies += 1
clips.append(("end", title_len + main_len + 0.5, None))
total = title_len + main_len + end_len
inputs, mix = [], []
for i, (key, at, limit) in enumerate(clips):
    inputs += ["-i", f"{speech}/{key}.wav"]
    ms = int(max(0, at) * 1000)
    cut = f",atrim=duration={limit:.2f},afade=t=out:st={max(0, limit - 0.25):.2f}:d=0.25" if limit else ""
    mix.append(f"[{i}:a]aresample=48000{cut},adelay={ms}|{ms}[a{i}]")
mix.append("".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0:duration=longest,apad,atrim=duration={total:.2f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
run([*inputs, "-filter_complex", ";".join(mix), "-map", "[aout]", "-ac", "2", "-c:a", "pcm_s16le", f"{out}/voices.wav"])

run(["-i", f"{out}/title.mp4", "-i", f"{out}/main.mp4", "-i", f"{out}/end.mp4", "-i", f"{out}/voices.wav",
     "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", f"{out}/navi-demo.mp4"])
print(f"navi-demo.mp4: {total:.1f} s")
