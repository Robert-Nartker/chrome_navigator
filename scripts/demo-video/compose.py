"""Builds the demo video: a title card, the recording (the page and Navi's panel side by side, with a
caption for each spoken command), and an end card, with the narrator, the user's commands and Navi's
replies laid in at the moments they happened.

Usage: python3 scripts/demo-video/compose.py <script.json> <out dir>   (writes <out dir>/navi-demo.mp4)
"""
import json, os, subprocess, sys

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
BG = "0x17153a"

def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)

def esc(text):
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")

events = rec["events"]
start = max(rec["siteStart"], rec["panelStart"]) + 1.2
end = next(e["t"] for e in events if e["kind"] == "end")
main_len = end - start
title_len = durations["title"] + 1.4
end_len = durations["end"] + 2.0

# Cards.
t = script["title"]
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={title_len}:r=30",
     "-vf", ",".join([
         f"drawtext=fontfile={BOLD}:text='{esc(t['heading'])}':fontsize=180:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-90",
         f"drawtext=fontfile={REG}:text='{esc(t['sub'])}':fontsize=54:fontcolor=0xc9c6ff:x=(w-tw)/2:y=(h)/2+90",
         "fade=t=in:st=0:d=0.6", f"fade=t=out:st={title_len - 0.5}:d=0.5", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/title.mp4"])
e = script["end"]
draws = [f"drawtext=fontfile={BOLD}:text='{esc(e['heading'])}':fontsize=140:fontcolor=white:x=(w-tw)/2:y=250"]
for i, line in enumerate(e["lines"]):
    font, color = (SEMI, "0x8f8bff") if "github" in line else (REG, "0xe4e2ff")
    draws.append(f"drawtext=fontfile={font}:text='{esc(line)}':fontsize=48:fontcolor={color}:x=(w-tw)/2:y={500 + i * 90}")
run(["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:d={end_len}:r=30",
     "-vf", ",".join(draws + ["fade=t=in:st=0:d=0.6", "format=yuv420p"]),
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/end.mp4"])

# The recording: the page (1280 wide) beside Navi's panel (640 wide), with captions for what's said.
captions = []
for ev in events:
    if ev["kind"] != "say":
        continue
    a = ev["t"] - start
    b = a + durations[ev["key"]] + 1.6
    captions.append(
        f"drawtext=fontfile={SEMI}:text='“{esc(ev['text'])}”':fontsize=46:fontcolor=white:box=1:boxcolor=0x17153a@0.88:boxborderw=26"
        f":x=(1280-tw)/2:y=h-170:enable='between(t,{a:.2f},{b:.2f})'")
filters = (
    f"[0:v]trim=start={start - rec['siteStart']:.3f}:duration={main_len:.3f},setpts=PTS-STARTPTS,fps=30[s];"
    f"[1:v]trim=start={start - rec['panelStart']:.3f}:duration={main_len:.3f},setpts=PTS-STARTPTS,fps=30,crop=640:1080:0:0[p];"
    f"[s][p]hstack=inputs=2,{','.join(captions)},format=yuv420p[v]"
)
run(["-i", rec["site"], "-i", rec["panel"], "-filter_complex", filters, "-map", "[v]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", f"{out}/main.mp4"])

# The voices, placed on the final timeline.
clips = [("title", 0.5)]
replies = 0
for ev in events:
    at = title_len + ev["t"] - start
    if ev["kind"] in ("narrator", "say"):
        clips.append((ev["key"], at))
    elif ev["kind"] == "navi":
        clips.append((f"navi-{replies}", at + 0.15))
        replies += 1
clips.append(("end", title_len + main_len + 0.6))
total = title_len + main_len + end_len
inputs, mix = [], []
for i, (key, at) in enumerate(clips):
    inputs += ["-i", f"{speech}/{key}.wav"]
    ms = int(max(0, at) * 1000)
    mix.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
mix.append("".join(f"[a{i}]" for i in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0:duration=longest,apad,atrim=duration={total:.2f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")
run([*inputs, "-filter_complex", ";".join(mix), "-map", "[aout]", "-ac", "2", "-c:a", "pcm_s16le", f"{out}/voices.wav"])

# Title, recording, end card, then the voices.
run(["-i", f"{out}/title.mp4", "-i", f"{out}/main.mp4", "-i", f"{out}/end.mp4", "-i", f"{out}/voices.wav",
     "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
     "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", f"{out}/navi-demo.mp4"])
print(f"navi-demo.mp4: {total:.1f} s")
