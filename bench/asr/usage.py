"""Summarizes Navi's usage log (Settings → Export usage log) by recognizer: how spoken commands were heard
and what came of them, plus the phrases that went wrong, so real use can steer the next fixes.

Usage: python3 bench/asr/usage.py navi-usage.csv [--since 2026-11-14]
"""
import argparse, collections, csv, statistics

ap = argparse.ArgumentParser()
ap.add_argument("csv")
ap.add_argument("--since", default="")
a = ap.parse_args()

rows = [r for r in csv.DictReader(open(a.csv, newline="", encoding="utf8")) if r["t"] >= a.since and r["path"] != "background"]
spoken = [r for r in rows if r.get("heard")]
print(f"{len(rows)} commands, {len(spoken)} spoken" + (f" since {a.since}" if a.since else ""))

def ms(xs):
    xs = [float(x) for x in xs if x not in ("", None)]
    return f"{statistics.median(xs):.0f} ms" if xs else "–"

by = collections.defaultdict(list)
for r in spoken:
    by[r.get("recognizer") or "chrome"].append(r)
print("\n| Recognizer | Spoken | Built-in | AI | Ignored | Failed | Marked misheard | Median wait after speech | Median run |")
print("|---|---|---|---|---|---|---|---|---|")
for rec, rs in sorted(by.items()):
    n = len(rs)
    count = lambda p: sum(1 for r in rs if r["path"] == p)
    pct = lambda k: f"{k} ({100 * k // n}%)"
    print(f"| {rec} | {n} | {pct(count('fast'))} | {pct(count('ai'))} | {pct(count('ignored'))} | {pct(count('error'))} | "
          f"{pct(sum(1 for r in rs if r.get('misheard') == 'true'))} | {ms(r['waitMs'] for r in rs)} | {ms(r['ms'] for r in rs if r['path'] == 'fast')} |")

# Faint phrases (little clear voice): how many acted, and what the ones left alone were. Many left-alone
# words that were really commands would mean the faint bar is too strict; many that acted wrongly, too loose.
faint = [r for r in spoken if r.get("faint") == "true"]
if faint:
    left = [r for r in faint if r.get("intent") == "faint"]
    print(f"\nFaint phrases: {len(faint)}, {len(faint) - len(left)} acted on, {len(left)} left alone: "
          + ", ".join(f"“{w}” ×{n}" for w, n in collections.Counter(r["heard"] for r in left).most_common(12)))

# What went wrong, newest first: marked misheard, failed, ignored, or heard differently than run.
print("\nWorth a look (newest first):")
for r in reversed(spoken):
    if r.get("intent") == "faint":
        continue  # summarized above
    why = "marked misheard" if r.get("misheard") == "true" else "failed" if r["path"] == "error" else "ignored" if r["path"] == "ignored" else ""
    if not why and r["heard"].strip().lower().rstrip(".!?") != r["command"].strip().lower().rstrip(".!?"):
        why = "matched by sound"
    if why:
        extra = f" | other guesses: {r['alternatives']}" if r.get("alternatives") else ""
        print(f"  {r['t'][:19]} [{r.get('recognizer') or 'chrome'}] {why}: heard “{r['heard']}” → ran “{r['command']}” ({r.get('intent') or r['path']}){extra}")
