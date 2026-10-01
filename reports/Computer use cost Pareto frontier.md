# Luna, Sol and Opus split the frontier

On a common OSWorld 2.1 partial-credit scale, the computer-use cost/performance frontier runs through three models and skips two. **GPT-6 Luna owns everything below about $0.30 per long-horizon task (up to ~57%), GPT-6.1 Sol at medium through max owns $0.60–$1.30 (65–75%), and Claude Opus 5.5 at high through max owns the top ($5–$12, 78–82%).** GPT-6 Astra is dominated at every effort level in this view, because its published max point (77% at $9.30) costs about twice what Opus 5.5 at high is estimated to cost for similar performance. Claude Sonnet 5.5 reaches the frontier only at max, and only marginally, because its lower efforts cost more than 6.1 Sol max and score less. The browser-specific view from Browser Use's BU Bench V2 reorders the top: **Astra at medium leads (80.6 at $8.87 per task), GPT-6 Sol at medium is the value point (66.9 at $1.20), Luna is the cheap tail, and Opus 5.5 sits below the frontier (59.4 at $4.21)**. Of the 27 model × effort points, **only 3 are measured on both axes**, 4 more have a measured score but a modelled cost, and the other 20 are estimated from effort-scaling curves, so the top of the chart is far less certain than the bottom. For a voice-driven browser agent, **GPT-6.1 Sol at medium is the default that holds up in every view**, Luna at medium to xhigh is the cheap fast path, Opus 5.5 at high is the escalation tier for long tasks where failure is costly, and max effort is almost never worth its cost or latency.

## Only three of 27 points are measured on both axes

The vendors never measured the same thing. **Anthropic reports OSWorld 2.1 with partial credit, one number per model:** Opus 5.5 scores 81.8% at max effort ([Anthropic](https://www.anthropic.com/claude-opus-5-5)), and Sonnet 5.5 scores 80.1% with no effort level stated ([Anthropic](https://www.anthropic.com/claude-sonnet-5-5)). Max is the likely setting for Sonnet, because four of its other table values match the Max points on the page's own effort charts. **OpenAI reports a different set: the 82-task no-internet "offline" subset of the OSWorld 2.0 August 8 release, scored with partial reward** ([OSWorld-V2 repo](https://github.com/xlang-ai/OSWorld-V2); [Kingy AI](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/)). On that set, GPT-6.1 Sol scores 71.4% at max for **$1.27 per task**, Astra 73.5% at max, and GPT-6 Sol 64.4% at $3.37 ([HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol)). Astra's cost per task is quoted at **$9.07–$9.44** ([Kingy AI](https://kingy.ai/blog/gpt-6-sol-vs-astra-effort-pricing/); [Vellum](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained)). Luna scores 52.7% at max for $0.27 ([Puter](https://developer.puter.com/blog/gpt-6-sol-luna-review/)) and 8.3% at low ([Emergent](https://emergent.sh/learn/gpt-6-luna-benchmarks)). No independent evaluator has run any of the five models on OSWorld 2.x. The official OSWorld-Verified sheet lists none of them ([os-world data](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx)), and HAL has paused adding new models ([HAL](https://hal.cs.princeton.edu/)).

**Claude Opus 5 is the only model in both vendors' tables, so it serves as the bridge.** It scores 70.2% in OpenAI's offline-subset table ([Steel data](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json)) and 74.0% in Anthropic's 2.1 table ([Anthropic](https://www.anthropic.com/claude-opus-5-5)), a **shift of +3.8 points, or +0.19 logits**. The chart therefore uses Anthropic's scale, labelled **"OSWorld 2.1 partial-credit equivalent, vendor harness."** Every OpenAI score moves up by the same +0.19 logits, so 6.1 Sol's 71.4% becomes 75.1% and Astra's 73.5% becomes 77.0%. One anchor model cannot pin the offset precisely, so converted points carry about ±4–5 points of 1σ uncertainty.

Strict (all-checkpoints) scores exist only as system-card snippets: Opus 5.5 at 48.7% ([llm-stats](https://llm-stats.com/blog/research/claude-opus-5-5-launch)) and Sonnet 5.5 at 43.5% ([Vellum](https://www.vellum.ai/blog/claude-sonnet-5-5-benchmarks-explained)). The CSV below adds a strict-equivalent column. It uses the fit logit(strict) = −1.696 + 1.131·logit(partial), which has r = 0.978 across 17 OSWorld 2.x rows, calibrated so that it reproduces those two published values.

**The cost axis is dollars per OSWorld-2.x-class task at list prices.** A task of this class is a long-horizon workflow that takes a human about 1.6 hours and an agent hundreds of tool calls. This is the unit OpenAI charts. Using it keeps cost and score internally consistent and makes three OpenAI points fully published.

Neither Anthropic model has a published computer-use cost, so **Opus 5.5 at max is estimated at $12 per task (80% range $7–$21)** by triangulating four cross-vendor anchors. OpenAI's own per-solved-task comparison puts Opus 5.5 at $36.67 against $34.95 for Astra and $9.60 for 6.1 Sol ([Vellum](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained)), and on Terminal-Bench Science at max Opus 5.5 costs $23.21 against Astra's $23.80 ([beri.net](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task)); both place Opus 5.5 at roughly Astra's $9.30 or a little above. A heavier chain starts from Opus 5 at roughly $25 per task on Anthropic's own OSWorld 2.0 chart ([DataCamp](https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5)) and scales it by Opus 5.5's 0.47–1.08× cost ratio to Opus 5 on WANDR and AutomationBench ([Anthropic](https://www.anthropic.com/claude-opus-5-5)), landing at $12–$27. Snorkel's finding that GPT models reach their scores with fewer tokens ([Snorkel](https://snorkel.ai/blog/osworld-2-0-why-computer-use-agents-fail-most-tasks/)) argues against pricing Opus off token-for-token parity with Sol, which would give only $5–$6.

Sonnet 5.5 at max is set at 0.94× the Opus max cost. This is the geometric mean of the screenshot-dominated cost model's ratio (0.70×) and Artificial Analysis's ratio (1.27×); the latter is high because Sonnet at max burns about 193k output tokens per task ([Artificial Analysis](https://artificialanalysis.ai/articles/claude-sonnet-5-5)).

A second cost column models a **short 8-step screenshot task**, the axis closest to a voice command. It assumes 1,100-token screenshots, full history and 100% cache hits at list prices, and uses the project's cost model built on Anthropic's image-token formula ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)).

## Effort curves from neighbouring benchmarks fill the other 20 points

OSWorld itself offers only a handful of effort pairs. From lower to higher effort:

| Model | OSWorld effort points | Source |
|---|---|---|
| GPT-6 Sol | low 43.9%, xhigh 60.5%, max 64.4% | [Emergent](https://emergent.sh/learn/gpt-6-sol-benchmarks); [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) |
| Luna | low 8.3%, max 52.7% | [Emergent](https://emergent.sh/learn/gpt-6-luna-benchmarks) |
| Opus 5 | medium 60.3% (at $12.67), max 70.2% | [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna); [Steel data](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json) |
| Sonnet 4.6 | medium 33.9%, max 41.5% | [Steel data](https://github.com/steel-dev/leaderboard) |

In logit terms, the low setting sits about **0.84 below max**, medium sits 0.32–0.66 below, and xhigh 0.17 below.

The 5.5 launch pages add exact effort-cost curves on other agentic benchmarks, extracted from the CSV embedded in each page. Opus 5.5 on WANDR, Perplexity's web data-collection benchmark, climbs 31.2%, 62.8%, 67.3%, 71.3% and 72.3% from low to max, at $1.20 to $37.92 per attempt ([Anthropic](https://www.anthropic.com/claude-opus-5-5)). Across four Opus 5.5 benchmarks, medium sits 0.21–0.51 logits below max. **Sonnet 5.5's curves are far steeper.** Terminal-Bench 4.0 climbs from 20.0% at low to 70.6% at max, and CursorBench from 35.8% to 55.5% ([Anthropic](https://www.anthropic.com/claude-sonnet-5-5)).

Each Claude template averages the model's own vendor curves with the OSWorld pairs, which tempers Sonnet's steep coding curves with the gentler gaps OSWorld has actually shown. GPT-6.1 Sol inherits its predecessor's published OSWorld curve. Astra gets a flatter curve, because its 72.6% launch score sits only 0.9 points under its 73.5% max and Artificial Analysis finds that "jumping from xhigh to max adds nothing" to its index ([Artificial Analysis](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra)). Luna keeps its two published OSWorld points and borrows the medium-to-xhigh shape from Browser Use's Luna sweep.

**Cost multipliers get two bounds, and the central value is their geometric mean.** The output-dominated bound comes from Artificial Analysis per-effort costs and the vendor curves: Opus 5.5 costs $0.55, $1.34, $1.82, $3.46 and $5.98 per index task from low to max ([Artificial Analysis](https://artificialanalysis.ai/articles/claude-opus-5-5)), and GPT-6.1 Sol $0.13 to $0.72 ([Artificial Analysis](https://artificialanalysis.ai/models/releases/gpt-6-1-sol)). The screenshot-dominated bound is a 30-step loop in which cached screenshot history, not thinking, drives the bill, so effort barely moves cost. The only OSWorld check, GPT-6 Sol's published xhigh/max cost ratio of 0.66 ($2.21/$3.37), lands at the output-dominated end, so the true low-effort costs may sit near the lower edge of their ranges.

Each cell in the table below shows the logit gap below max effort, then the cost as a share of the max-effort cost.

| Model | none / thinking-off | low | medium | high | xhigh | max anchor (score; $/task) |
|---|---|---|---|---|---|---|
| Opus 5.5 | not available (always thinks) | −0.94 / 0.20 | −0.42 / 0.34 | −0.24 / 0.41 | −0.12 / 0.61 | 81.8 published; $12 estimated |
| Sonnet 5.5 | −1.39 / 1.1× low | −1.19 / 0.14 | −0.85 / 0.16 | −0.52 / 0.26 | −0.21 / 0.46 | 80.1 published; $11 estimated |
| GPT-6 Astra | not available | −0.70 / 0.45 | −0.38 / 0.64 | −0.20 / 0.72 | −0.05 (72.6 launch point) / 0.81 | 73.5→77.0 converted; $9.30 published |
| GPT-6.1 Sol | not available | −0.84 / 0.37 | −0.48 / 0.48 | −0.31 / 0.60 | −0.17 / 0.77 | 71.4→75.1 converted; $1.27 published |
| GPT-6 Luna | −2.90 / 1.5× low | −2.51 (published 8.3) / 0.20 | −1.25 / 0.33 | −0.76 / 0.58 | −0.30 / 0.75 | 52.7→57.4 converted; $0.27 published |

Several vendor curves plateau at max. Opus 5.5 scores lower on Terminal-Bench at max (64.8%) than at xhigh (66.4%), and Sonnet 5.5 scores lower at max than at xhigh on FrontierCode ([Anthropic](https://www.anthropic.com/claude-sonnet-5-5)). The templates therefore put xhigh within about 0.1–0.2 logits of max.

## The 27-point chart: Luna, Sol and Opus trace the frontier

The table and CSV below are chart-ready. Performance is the "OSWorld 2.1 partial-credit equivalent" in percent, and cost is dollars per OSWorld-2.x-class long-horizon task at list prices. Ranges are the 10th–90th percentiles of 20,000 Monte Carlo draws that share an error term wherever the error is genuinely common: the OpenAI→2.1 bridge offset, each model's max-effort anchor, each model's effort-curve steepness and each model's cost anchor. The frontier probability is the share of draws in which the point is non-dominated. Type codes are P for published, C for converted from a published OSWorld 2.0 offline score, E for estimated from effort curves and X for estimated from cross-vendor cost anchors.

| Model | Level | Score (80% range) | $ / OSWorld-class task (80% range) | $ / 8-step short task (modelled) | Type (score / cost) | Frontier (probability) | Sources |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | low | **63.6** (47–72) | **$2.4** ($1.1–$5.5) | $0.13 | E / E | no (0.10) | A55, OSW-EFF, AA, XV |
| Opus 5.5 | medium | **74.6** (68–80) | **$4.1** ($2.3–$7.6) | $0.15 | E / E | no (0.37) | A55, OSW-EFF, AA, XV |
| Opus 5.5 | high | **77.9** (73–83) | **$4.9** ($2.8–$8.8) | $0.17 | E / E | **yes** (0.56) | A55, OSW-EFF, AA, XV |
| Opus 5.5 | xhigh | **79.9** (75–84) | **$7.3** ($4.3–$13) | $0.21 | E / E | **yes** (0.56) | A55, OSW-EFF, AA, XV |
| Opus 5.5 | max | **81.8** (78–85) | **$12** ($7.1–$21) | $0.38 | P / X | **yes** (0.48) | A55, XV |
| Sonnet 5.5 | thinking-off (between_tools @ low) | **50.2** (29–63) | **$1.7** ($0.64–$4.6) | $0.067 | E / E | no (0.02) | S55, OSW-EFF, AA, XV |
| Sonnet 5.5 | low | **55.2** (34–65) | **$1.5** ($0.61–$4.1) | $0.072 | E / E | no (0.06) | S55, OSW-EFF, AA, XV |
| Sonnet 5.5 | medium | **63.2** (44–74) | **$1.8** ($0.77–$4.5) | $0.080 | E / E | no (0.17) | S55, OSW-EFF, AA, XV |
| Sonnet 5.5 | high | **70.5** (57–77) | **$2.9** ($1.4–$6.0) | $0.090 | E / E | no (0.18) | S55, OSW-EFF, AA, XV |
| Sonnet 5.5 | xhigh | **76.5** (70–81) | **$5.2** ($2.9–$9.8) | $0.12 | E / E | no (0.32) | S55, OSW-EFF, AA, XV |
| Sonnet 5.5 | max | **80.1** (75–84) | **$11** ($6.4–$21) | $0.26 | P (effort inferred) / X | **yes, marginal** (0.35) | S55, XV, AA |
| GPT-6 Astra | low | **62.5** (52–73) | **$4.2** ($2.6–$6.6) | $0.35 | E / E | no (0.01) | OSW-EFF, AA, OAI61 |
| GPT-6 Astra | medium | **69.6** (60–78) | **$5.9** ($4.7–$7.5) | $0.38 | E / E | no (0.05) | OSW-EFF, AA, OAI61 |
| GPT-6 Astra | high | **73.3** (65–80) | **$6.7** ($5.6–$7.9) | $0.40 | E / E | no (0.12) | OSW-EFF, AA, OAI61 |
| GPT-6 Astra | xhigh | **76.2** (69–83) | **$7.6** ($6.8–$8.4) | $0.42 | C (effort label ambiguous) / E | no (0.20) | OAIA, BRIDGE, AA |
| GPT-6 Astra | max | **77.0** (70–83) | **$9.30** ($9.07–$9.44) | $0.47 | C / P | no (0.16) | OAI61, BRIDGE |
| GPT-6.1 Sol | low | **56.6** (46–67) | **$0.47** ($0.27–$0.82) | $0.063 | E / E | no (0.29) | OSW-EFF, AA, OAI61 |
| GPT-6.1 Sol | medium | **65.1** (56–74) | **$0.61** ($0.42–$0.89) | $0.065 | E / E | **yes** (0.72) | OSW-EFF, AA, OAI61 |
| GPT-6.1 Sol | high | **68.9** (60–77) | **$0.76** ($0.61–$0.96) | $0.068 | E / E | **yes** (0.88) | OSW-EFF, AA, OAI61 |
| GPT-6.1 Sol | xhigh | **71.8** (63–79) | **$0.97** ($0.88–$1.1) | $0.077 | E / E | **yes** (0.90) | OSW-EFF, AA, OAI61 |
| GPT-6.1 Sol | max | **75.1** (67–82) | **$1.27** ($1.27–$1.30) | $0.091 | C / P | **yes** (0.89) | OAI61, BRIDGE |
| GPT-6 Luna | none | **6.9** (5–12) | **$0.081** ($0.029–$0.28) | $0.0031 | E / E | no (0.19) | OAISL, BU, AA |
| GPT-6 Luna | low | **9.9** (7–17) | **$0.054** ($0.022–$0.13) | $0.0033 | C (pre-image-fix) / E | **yes** (0.95) | OAISL, BRIDGE, AA |
| GPT-6 Luna | medium | **27.8** (21–43) | **$0.090** ($0.050–$0.16) | $0.0036 | E / E | **yes** (0.98) | OAISL, BU, AA |
| GPT-6 Luna | high | **38.6** (32–53) | **$0.16** ($0.11–$0.21) | $0.0044 | E / E | **yes** (0.98) | OAISL, BU, AA |
| GPT-6 Luna | xhigh | **49.9** (44–63) | **$0.20** ($0.16–$0.25) | $0.0051 | E / E | **yes** (0.97) | OAISL, BU, AA |
| GPT-6 Luna | max | **57.4** (52–69) | **$0.27** ($0.21–$0.33) | $0.0061 | C / P (both pre-image-fix) | **yes** (0.96) | OAISL, BRIDGE |

| Source key | What it points to |
|---|---|
| A55 | [Anthropic Opus 5.5 launch page](https://www.anthropic.com/claude-opus-5-5), including table and embedded effort-cost data |
| S55 | [Anthropic Sonnet 5.5 launch page](https://www.anthropic.com/claude-sonnet-5-5) |
| OAI61 | [OpenAI GPT-6.1 Sol post](https://openai.com/index/introducing-gpt-6-1-sol/), read via [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) and [Vellum](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained) |
| OAISL | [OpenAI GPT-6 Sol and Luna post](https://openai.com/index/introducing-gpt-6-sol-and-luna/), read via [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna), [Puter](https://developer.puter.com/blog/gpt-6-sol-luna-review/) and [Emergent](https://emergent.sh/learn/gpt-6-luna-benchmarks) |
| OAIA | OpenAI Astra launch, read via [Steel's OSWorld 2.0 data](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json) |
| BRIDGE | Opus 5 anchor: 70.2 in OpenAI's table vs 74.0 in Anthropic's |
| OSW-EFF | The OSWorld 2.0 effort pairs listed in the previous section |
| AA | Artificial Analysis per-effort cost and token data ([Opus 5.5](https://artificialanalysis.ai/articles/claude-opus-5-5), [Sonnet 5.5](https://artificialanalysis.ai/articles/claude-sonnet-5-5), [GPT-6.1 Sol](https://artificialanalysis.ai/models/releases/gpt-6-1-sol), [Astra](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra), [Luna](https://artificialanalysis.ai/models/releases/gpt-6-luna)) |
| XV | Cross-vendor cost anchors ([Vellum](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained), [beri.net](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task), [DataCamp](https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5)) |
| BU | [Browser Use BU Bench V2 chart](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg) |

```csv
model,reasoning_level,perf_osw21_partial_equiv,perf_low_p10,perf_high_p90,strict_equiv,usd_per_osworld_class_task,usd_low_p10,usd_high_p90,usd_short_8step_modelled,usd_15step_modelled,usd_30step_modelled,perf_point_type,cost_point_type,on_frontier_osworld_view,frontier_probability,on_frontier_short_task_view,sources
Opus 5.5,low,63.6,47,72,25,2.4,1.1,5.5,0.13,0.42,4.3,estimated-from-effort-curve,estimated-from-effort-curve,no,0.10,no,"A55 curves; OSW-EFF; AA; XV"
Opus 5.5,medium,74.6,68,80,37,4.1,2.3,7.6,0.15,0.50,4.7,estimated-from-effort-curve,estimated-from-effort-curve,no,0.37,no,"A55 curves; OSW-EFF; AA; XV"
Opus 5.5,high,77.9,73,83,42,4.9,2.8,8.8,0.165,0.57,5.0,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.56,yes,"A55 curves; OSW-EFF; AA; XV"
Opus 5.5,xhigh,79.9,75,84,45,7.3,4.3,13,0.21,0.79,6.1,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.56,yes,"A55 curves; OSW-EFF; AA; XV"
Opus 5.5,max,81.8,78,85,49,12,7.1,21,0.38,1.5,9.9,published,estimated-from-cross-vendor-anchors,yes,0.48,yes,"A55; XV"
Sonnet 5.5,thinking-off (between_tools@low),50.2,29,63,14,1.7,0.64,4.6,0.067,0.22,2.2,estimated-from-effort-curve,estimated-from-effort-curve,no,0.02,no,"S55 curves; OSW-EFF; AA; XV"
Sonnet 5.5,low,55.2,34,65,17,1.5,0.61,4.1,0.072,0.24,2.4,estimated-from-effort-curve,estimated-from-effort-curve,no,0.06,no,"S55 curves; OSW-EFF; AA; XV"
Sonnet 5.5,medium,63.2,44,74,23,1.8,0.77,4.5,0.080,0.27,2.5,estimated-from-effort-curve,estimated-from-effort-curve,no,0.17,no,"S55 curves; OSW-EFF; AA; XV"
Sonnet 5.5,high,70.5,57,77,30,2.9,1.4,6.0,0.090,0.32,2.8,estimated-from-effort-curve,estimated-from-effort-curve,no,0.18,no,"S55 curves; OSW-EFF; AA; XV"
Sonnet 5.5,xhigh,76.5,70,81,38,5.2,2.9,9.8,0.12,0.47,3.5,estimated-from-effort-curve,estimated-from-effort-curve,no,0.32,yes,"S55 curves; OSW-EFF; AA; XV"
Sonnet 5.5,max,80.1,75,84,43,11,6.4,21,0.26,1.1,6.6,published (effort inferred),estimated-from-cross-vendor-anchors,yes (marginal),0.35,yes,"S55; XV; AA"
GPT-6 Astra,low,62.5,52,73,25,4.2,2.6,6.6,0.35,1.1,11,estimated-from-effort-curve,estimated-from-effort-curve,no,0.01,no,"OSW-EFF; AA; OAI61"
GPT-6 Astra,medium,69.6,60,78,32,5.9,4.7,7.5,0.38,1.3,12,estimated-from-effort-curve,estimated-from-effort-curve,no,0.05,no,"OSW-EFF; AA; OAI61"
GPT-6 Astra,high,73.3,65,80,36,6.7,5.6,7.9,0.40,1.4,13,estimated-from-effort-curve,estimated-from-effort-curve,no,0.12,no,"OSW-EFF; AA; OAI61"
GPT-6 Astra,xhigh,76.2,69,83,41,7.6,6.8,8.4,0.42,1.5,13,converted (effort label ambiguous),estimated-from-effort-curve,no,0.20,no,"OAIA; BRIDGE; AA"
GPT-6 Astra,max,77.0,70,83,42,9.30,9.07,9.44,0.47,1.7,14,converted,published,no,0.16,no,"OAI61; BRIDGE"
GPT-6.1 Sol,low,56.6,46,67,20,0.47,0.27,0.82,0.063,0.19,2.1,estimated-from-effort-curve,estimated-from-effort-curve,no,0.29,no,"OSW-EFF (GPT-6 Sol curve); AA; OAI61"
GPT-6.1 Sol,medium,65.1,56,74,27,0.61,0.42,0.89,0.065,0.21,2.1,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.72,yes,"OSW-EFF (GPT-6 Sol curve); AA; OAI61"
GPT-6.1 Sol,high,68.9,60,77,31,0.76,0.61,0.96,0.068,0.22,2.2,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.88,yes,"OSW-EFF (GPT-6 Sol curve); AA; OAI61"
GPT-6.1 Sol,xhigh,71.8,63,79,35,0.97,0.88,1.1,0.077,0.26,2.4,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.90,yes,"OSW-EFF (GPT-6 Sol curve); AA; OAI61"
GPT-6.1 Sol,max,75.1,67,82,39,1.27,1.27,1.30,0.091,0.32,2.7,converted,published,yes,0.89,yes,"OAI61; BRIDGE"
GPT-6 Luna,none,6.9,5,12,1,0.081,0.029,0.28,0.0031,0.0097,0.11,estimated-from-effort-curve,estimated-from-effort-curve,no,0.19,yes,"OAISL; BU Luna shape; AA"
GPT-6 Luna,low,9.9,7,17,1,0.054,0.022,0.13,0.0033,0.010,0.11,converted (pre-image-fix),estimated-from-effort-curve,yes,0.95,yes,"OAISL; BRIDGE; AA"
GPT-6 Luna,medium,27.8,21,43,6,0.090,0.050,0.16,0.0036,0.012,0.12,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.98,yes,"OAISL; BU Luna shape; AA"
GPT-6 Luna,high,38.6,32,53,10,0.16,0.11,0.21,0.0044,0.015,0.13,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.98,yes,"OAISL; BU Luna shape; AA"
GPT-6 Luna,xhigh,49.9,44,63,15,0.20,0.16,0.25,0.0051,0.018,0.15,estimated-from-effort-curve,estimated-from-effort-curve,yes,0.97,yes,"OAISL; BU Luna shape; AA"
GPT-6 Luna,max,57.4,52,69,20,0.27,0.21,0.33,0.0061,0.023,0.17,converted (pre-image-fix),published (pre-image-fix),yes,0.96,yes,"OAISL; BRIDGE"
```

**The long-task frontier has three segments separated by a gap.** Luna from low through max stays on the frontier in at least 95% of draws and carries the chart from about 10% to 57% for under $0.30. GPT-6.1 Sol from medium through max holds 72–90% of draws, covering 65% to 75% for $0.61 to $1.27; Sol at low drops off because Luna at max matches its score for 57% of the cost. Nothing between $1.27 and about $4.90 beats 6.1 Sol max, so Opus 5.5 medium (74.6 at $4.1), Sonnet 5.5 high and xhigh, and Astra low and medium all fall into that gap and are dominated. Opus 5.5 from high through max is a coin flip at 48–56% of draws, adding **+2.8, +4.8 and +6.7 points over 6.1 Sol max at 3.8×, 5.8× and 9.4× the cost**.

Sonnet 5.5 max clears Opus 5.5 xhigh by only 0.2 points at 1.5× the cost, so it is a marginal frontier point. It drops off entirely on the strict-equivalent axis, because its published strict score (43.5%) sits below what the fit predicts. Astra is on the frontier in no more than 20% of draws: its published max point costs 1.9× Opus 5.5 high's estimate for about one point less. That verdict rests on the cross-vendor bridge, though, and an Astra score 5 points higher would put it back in contention.

**The short-task view agrees apart from two changes.** Sonnet 5.5 at xhigh joins the frontier (76.5 at $0.12 per 8-step task, against 6.1 Sol max at $0.091), because short tasks never build up the screenshot histories that make Sonnet's steep thinking multiplier expensive. Luna's none setting also becomes the cheapest point.

Some superseded points can be plotted in grey on the same 2.1-equivalent scale:

| Model | Setting | Score (2.1-equivalent) | Cost per task |
|---|---|---|---|
| GPT-6 Sol | xhigh | 64.9 | $2.21 |
| GPT-6 Sol | max | 68.6 | $3.37 |
| Claude Opus 5 | medium | 64.7 | $12.67 |
| GPT-5.6 Sol | medium | 54.4 | $2.73 |

Sources: [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna); [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol); [Puter](https://developer.puter.com/blog/gpt-6-sol-luna-review/). Opus 5's medium point at $12.67, against Opus 5.5 medium's estimated $4.1, shows how much of Anthropic's cost gap closed in one generation.

## Browser Use's benchmark crowns Astra and demotes Opus

**BU Bench V2 is the only independent browser benchmark that plots these models against dollars per task** ([Browser Use](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg)). The chart is dated 2026-09-23 and uses the legacy 60-task cut. It scores a weighted findings rubric after judge penalties ("not % of tasks solved") and counts only the agent's API cost, not the judge's. It publishes no confidence intervals. The ±5-point ranges below are therefore an assumption, based on the 60-task sample and on Astra moving from 77.3 to 80.63 between the September 9 and September 23 versions of the chart ([Browser Use commits](https://github.com/browser-use/benchmark/commits/main)).

| Model | Level | BU Bench V2 score (±5) | $ per task | Type | Pareto frontier |
|---|---|---|---|---|---|
| GPT-6 Astra | medium | **80.63** | **$8.87** | published | **yes** |
| GPT-6 Sol (6.1's predecessor) | medium | **66.85** | **$1.20** | published, pre-image-fix | **yes** |
| Claude Opus 5.5 | not labelled | 59.40 | $4.21 | published | no (dominated by GPT-6 Sol medium) |
| GPT-6 Luna | xhigh | **57.55** | **$0.190** | published, pre-image-fix | **yes** |
| GPT-6 Luna | high | **53.95** | **$0.155** | published, pre-image-fix | **yes** |
| GPT-6 Luna | medium | **50.30** | **$0.126** | published, pre-image-fix | **yes** |
| GPT-6 Luna | low | **40.68** | **$0.018** | published, pre-image-fix | **yes** |
| GPT-6 Luna | none | 31.75 | $0.077 | published, pre-image-fix | no (dominated by Luna low) |

```csv
model,reasoning_level,bu_bench_v2_legacy60_score,score_low,score_high,usd_per_task,point_type,is_target_model,on_frontier,notes
GPT-6 Astra,medium,80.63,75.6,85.6,8.87,published,yes,yes,"Sep-9 chart version showed 77.3"
GPT-6 Sol,medium,66.85,61.9,71.9,1.20,published,predecessor of GPT-6.1 Sol,yes,"pre-image-fix; no GPT-6.1 Sol run yet"
Claude Opus 5.5,not labelled,59.40,54.4,64.4,4.21,published,yes,no,"effort unstated; dominated by GPT-6 Sol medium"
GPT-6 Luna,xhigh,57.55,52.6,62.6,0.190,published,yes,yes,"pre-image-fix; Browser Use default executor from 2026-09-24"
GPT-6 Luna,high,53.95,49.0,59.0,0.155,published,yes,yes,"pre-image-fix"
GPT-6 Luna,medium,50.30,45.3,55.3,0.126,published,yes,yes,"pre-image-fix"
GPT-6 Luna,low,40.68,35.7,45.7,0.018,published,yes,yes,"pre-image-fix; cheapest point"
GPT-6 Luna,none,31.75,26.8,36.8,0.077,published,yes,no,"costs 4.3x low and scores 8.9 lower"
Claude Fable 5.1,high,56.23,51.2,61.2,8.11,published,no (anchor),no,
Claude Opus 5,not labelled,50.53,45.5,55.5,7.37,published,no (anchor),no,"median 86 steps, 36 min"
GPT-5.6 Sol,xhigh,49.07,44.1,54.1,7.80,published,no (anchor),no,"median 119 steps"
DeepSeek V4.1 Flash,max,47.88,42.9,52.9,0.263,published,no (anchor),no,
GPT-5.6 Luna,xhigh,41.17,36.2,46.2,0.358,published,no (anchor),no,"median 135 steps"
GPT-5.6 Sol,default,38.45,33.5,43.5,2.71,published,no (anchor),no,"median 70 steps"
```

**The browser frontier runs Luna low → medium → high → xhigh → GPT-6 Sol medium → Astra medium.** **Astra buys 13.8 extra points for 7.4× GPT-6 Sol's cost**, which makes it the clear quality leader for research-style browsing, while **Opus 5.5 scores 7.5 points below GPT-6 Sol medium at 3.5× the cost**, a comparison [The Neuron](https://www.theneurondaily.com/p/gpt-6-sol-vs-claude-opus-5-5) also reports. Luna's none setting costs 4.3× as much as low and scores 8.9 points less, the clearest published evidence that switching reasoning off can be a false economy inside an agent loop. The day after this chart, Browser Use made Luna at xhigh its default benchmark executor ([Browser Use commits](https://github.com/browser-use/benchmark/commits/main)), a practitioner's vote for Luna xhigh as the value point.

Sonnet 5.5 and GPT-6.1 Sol are both missing from the chart. 6.1 Sol beats GPT-6 Sol on OSWorld at 62% lower cost at max, so it should land at or above the Sol medium point for no more money, but that is untested.

**The two views disagree at the top because harness and scoring matter as much as the model.** HAL found Claude models do better inside Browser-Use and OpenAI models inside SeeAct, with double-digit scaffold gaps ([HAL paper](https://arxiv.org/abs/2510.11977)). A health-admin benchmark measured Opus 4.6 at 36.3% with its native agent and 14.8% in a generic screenshot harness ([Steel data](https://github.com/steel-dev/leaderboard)). The two views should therefore stay on separate charts. They agree at the bottom of the frontier (Luna, then Sol at medium) and split at the expensive end, where Opus leads on long desktop workflows and Astra on rubric-scored browsing.

## Known data problems add 5–15 points of uncertainty

**Every OpenAI number came from search-result snippets**, because openai.com was unreachable. The Anthropic strict scores and system-card harness details also come only from snippets. Several snippets contradict each other. The table below records each conflict and how the chart treats it.

| Issue | Conflicting values | Treatment in the chart |
|---|---|---|
| Astra OSWorld score | 72.6% at launch ("max at any effort", though another snippet says only xhigh was available then) vs 73.5% at max in the 6.1 Sol post | 73.5% used as max; 72.6% used as the xhigh point and flagged as ambiguous |
| Astra max cost | $9.07, $9.30 and $9.44 | $9.30, with range $9.07–$9.44 |
| 6.1 Sol max cost | $1.27 vs $1.30 | $1.27 |
| Luna max score | 52.7% vs 66.6% | 52.7%; the 66.6% figure is DeepSWE v1.1 ([AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna)) |
| "$5.47 vs $23.21 / $23.80" labelled as OSWorld | — | Actually Terminal-Bench Science ([beri.net](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task)); used only as a cost ratio |
| "$0.27" | Appears both as Luna's OSWorld max cost and as GPT-6 Sol's xhigh AutomationBench cost | Kept for Luna and flagged; range $0.21–$0.33 |
| Per-solved-task OSWorld costs ($9.60 / $34.95 / $36.67) | Imply 13% success for 6.1 Sol but 27% for Astra, which is inconsistent | Only the cross-model ratios are used |
| Artificial Analysis Astra cost per task | $0.82–$3.26 vs $0.46–$1.67 | The series attributed to Artificial Analysis is used; both give similar ratios |
| Opus 5.5 labelled "OSWorld 2.0" by aggregators | Anthropic labels it 2.1 ([llm-stats](https://llm-stats.com/benchmarks/osworld-2.0)); a snippet says it was re-run on September 10 task files, before 2.1's September 16 release | Treated as 2.1 |

**The image-encoding bug is the largest known bias.** On 2026-09-25 OpenAI fixed a defect that had "degraded how the models understood images" in GPT-6 Sol and Luna, including in computer use. After the fix, Luna's RefCOCOg localization IoU rose from 28.8% to 60.0% ([Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-image-bug-fix-rerun-evals); [KuCoin](https://www.kucoin.com/news/flash/openai-fixes-gpt-6-image-bug-luna-s-visual-localization-doubles)). Every published Luna and GPT-6 Sol score predates the fix: the OSWorld figures are from September 22 and the BU Bench figures from September 23. No reruns have appeared. Luna's ranges therefore carry up to +0.3 logits of upside, about +7 points at max. The fix may also explain part of GPT-6.1 Sol's 7-point jump over GPT-6 Sol, since 6.1 Sol was benchmarked after it.

**Per-effort data is missing for the newest models.** Anthropic has published no OSWorld per-effort points for Opus 5.5 or Sonnet 5.5, and the system cards that might contain them sit on a blocked CDN. OpenAI has published nothing below xhigh for Astra, nothing below max for 6.1 Sol, and nothing at none, medium, high or xhigh for Luna. Sonnet 5.5's 80.1% has no stated effort. If it was run at high, the API default, every estimated Sonnet point understates performance by about half a logit.

**Harness differences add error the ranges only partly capture.** Anthropic's harness keeps every screenshot and compacts context server-side past 100k tokens, while OpenAI's is a modified Responses API with a latency simulation and unconfirmed step budgets, and batched tool calls alone move OSWorld 2.0 partial scores by up to 5.5 points ([Steel data](https://github.com/steel-dev/leaderboard)). The whole OpenAI side also rests on one bridge model whose three OSWorld 2.0 runs span 68.3–70.6%, so any bridge error shifts all sixteen OpenAI points together. The Monte Carlo draws treat that as a shared term, which is why Astra versus Opus stays uncertain while Sol versus Luna does not.

On the cost side, the project's `src/lib/models.ts` still bills OpenAI cache writes at 1.0× the input price. Secondary sources say GPT-5.6 and later charge 1.25× ([CloudZero](https://www.cloudzero.com/blog/openai-pricing/)), which would add about 10% to modelled OpenAI costs.

## Voice commands favour Sol medium with a Luna fast path

Voice commands are short tasks of roughly 2–10 steps, not 1.6-hour OSWorld workflows. **On short tasks, cached screenshot input dominates the bill, which flattens the cost of effort.** Moving 6.1 Sol from low to max raises an 8-step task only from $0.063 to $0.091 (+45%), compared with 2.7× on long tasks. The effort choice for voice is therefore mostly about latency and accuracy, not price.

Latency scales with thinking tokens per step. At GPT-6 Sol's roughly 104 tokens/s, 6.1 Sol needs about 4.5 seconds per step at medium and about 12 at max; Luna generates about 157 tokens/s and Astra only 57–59 ([Artificial Analysis](https://artificialanalysis.ai/models/comparisons/gpt-6-astra-vs-gpt-5-6-sol)). The only reported Claude side-by-side, a single run of about 6 steps, took 68 seconds on Opus 5.5 and 48 on Sonnet 5.5 ([beri.net](https://www.beri.net/article/claude-sonnet-5-5-vs-opus-5-5-cost-per-task-matched-score-effort-between-tools-migration)).

**GPT-6.1 Sol at medium should be the default.** It sits on the long-task frontier in 72% of draws and on the short-task frontier, and costs about $0.065 per 8-step screenshot task. Early lean-agent measurements in the project's notes put a 4-step DOM-first task at about $0.003, roughly 20× less; full NaviBench results will be reported separately. Its predecessor at medium is also the value point on BU Bench. The project's current default, 6.1 Sol at low, saves only about 4% per short task and falls off the long-task frontier. Medium is the better default unless NaviBench shows a latency penalty that users would notice. High and xhigh are worth reserving for multi-step flows, where they add about 4–7 points for 25–60% more cost on long tasks.

**Luna at medium to xhigh is the fast path.** It costs about a fifteenth as much per step as Sol, has the fastest output, and is the setting Browser Use chose for its own default executor. Luna's none setting belongs in routing and classification, not in acting, since it is dominated by low on BU Bench. Every Luna number predates the image fix, so Luna should be re-tested before it is ruled out for any class of task.

**Opus 5.5 at high is the escalation tier for long, multi-app tasks where failure is costly.** It is worth about 3–5 partial-credit points over 6.1 Sol max at 4–6× the cost, but the browser evidence does not back it, since it is dominated on BU Bench. Anthropic lets effort change mid-conversation without invalidating the prompt cache, through a per-message `output_config` behind a beta header ([effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)), which suits an escalate-on-failure design. Sonnet 5.5 earns a test only at xhigh, the one Sonnet setting that reaches a frontier, and only in the short-task view. Its thinking-off mode (`between_tools`, allowed only at low, medium and high) is probably dominated by low: Anthropic's earlier computer-use guidance says low "uses fewer output tokens than disabling thinking entirely" ([computer use docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)), and Luna's BU Bench points show the same pattern. Astra is a research-mode option rather than a default, with the best browser quality at about 7× GPT-6 Sol's cost and the slowest output. Max effort is worth skipping everywhere: Opus max costs 1.6× xhigh for +1.9 points, Astra's xhigh→max step adds 0.8 points for 22% more cost, and Sonnet max is dominated by Opus 5.5 on Artificial Analysis.

**Paid speed tiers are the other latency lever.** Opus fast mode costs 2× for up to 2.5× speed ([Anthropic](https://www.anthropic.com/claude-opus-5-5)). OpenAI's Ultrafast costs 6× for up to 300 tokens/s; it is available on Astra and pending for 6.1 Sol ([VentureBeat](https://venturebeat.com/technology/openais-gpt-6-1-sol-offers-astra-like-performance-at-1-5th-price-a-new-ultrafast-tier-clocks-at-300-tokens-per-second)). Ultrafast 6.1 Sol at medium would cost about $0.39 per 8-step screenshot task, the same as Astra medium but with roughly five times Astra's output speed. On a lean DOM-first agent that comes to pennies, which makes it the most interesting latency option for voice.

## Conclusion

The frontier is a relay between vendors, not one vendor's curve. OpenAI's cheap tiers own the bottom two-thirds of the cost range, Anthropic's Opus owns the top, and no single model spans it. The bottom (Luna, then Sol at medium) holds across both views, both benchmark families and 20,000 draws of uncertainty. The top is contested: Opus leads on long desktop workflows and Astra on rubric-scored browsing, and the gap between them is smaller than the uncertainty in the OSWorld version bridge. Within each model, effort moves cost more than it moves performance: low to max spans about 5× in cost on long tasks, and every model's max setting is dominated or marginal. For a latency-bound product, turn effort down first and change model tier second.

Three pending data sources would redraw this chart more than any further modelling: OpenAI's post-fix reruns of Luna and Sol, Anthropic's per-effort OSWorld 2.1 sweeps if the system cards contain them, and the project's own NaviBench results on short voice-style tasks, where the long-horizon gaps shown here are likely to compress.

## Addendum: Navi's own browser tests (measured)

After this report was written, the project's own benchmark (NaviBench) finished a sweep of the three GPT models at every reasoning level they accept. It uses the six hardest tasks in `bench/tasks.json` (the `hard-*` tasks on `market.html` and `workspace.html`), run through the real extension on 2026-09-30, 2 runs per task (12 per row), with a 25-step limit. Navi sends element lists and page text, not screenshots, so these costs are far below the computer-use figures above. Claude models could not be run: no Anthropic key reached the test machine. The ranges are 80% Wilson intervals for a pass rate from 12 runs.

| Model | Reasoning | Passed | 80% range | $ per task | Median time | Avg steps |
|---|---|---|---|---|---|---|
| GPT-6.1 Sol | low | 12/12 | 88–100% | $0.0085 | 11.9 s | 8.6 |
| GPT-6.1 Sol | medium | 11/12 | 76–98% | $0.0076 | 10.9 s | 7.7 |
| GPT-6.1 Sol | high | 12/12 | 88–100% | $0.0083 | 11.4 s | 8.5 |
| GPT-6.1 Sol | xhigh | 12/12 | 88–100% | $0.0107 | 11.9 s | 10.6 |
| GPT-6.1 Sol | max | 12/12 | 88–100% | $0.0130 | 16.4 s | 10.3 |
| GPT-6 Astra | low | 12/12 | 88–100% | $0.0533 | 13.9 s | 8.3 |
| GPT-6 Astra | medium | 12/12 | 88–100% | $0.0542 | 13.7 s | 8.6 |
| GPT-6 Astra | high | 12/12 | 88–100% | $0.0558 | 12.2 s | 8.7 |
| GPT-6 Astra | xhigh | 12/12 | 88–100% | $0.0600 | 13.8 s | 9.1 |
| GPT-6 Astra | max | 12/12 | 88–100% | $0.0717 | 18.1 s | 9.1 |
| GPT-6 Luna | none | 5/12 | 26–60% | $0.0005 | 7.0 s | 7.8 |
| GPT-6 Luna | low | 6/12 | 33–67% | $0.0004 | 5.7 s | 5.9 |
| GPT-6 Luna | medium | 5/12 | 26–60% | $0.0004 | 5.3 s | 5.5 |
| GPT-6 Luna | high | 7/12 | 40–74% | $0.0006 | 8.9 s | 7 |
| GPT-6 Luna | xhigh | 8/12 | 48–81% | $0.0006 | 8.2 s | 6.7 |
| GPT-6 Luna | max | 9/12 | 57–87% | $0.0008 | 9.5 s | 7.2 |

What it adds to the picture:

- GPT-6.1 Sol passed 11–12 of 12 at every level; cost per task moved only from $0.008 to $0.013 between low and max, and median time from about 11 s to 16 s. For short, text-based browser tasks, reasoning level mostly buys latency, not success.
- GPT-6 Astra also passed everything, at about 6x Sol's cost. It is dominated in Navi's setting, matching its position on the computer-use chart.
- GPT-6 Luna was about 17x cheaper than Sol but passed 5–9 of 12, rising with reasoning; 'none' cost more than 'low' because it took extra steps, which matches Browser Use's Luna result.
- At Navi's default limit of 12 steps (since raised to 20), the multi-email reply task fails for every model (they run out of steps), so the default limit, not the model, is the binding constraint on longer tasks.

The interactive chart with all three views (computer use, browser use, Navi's tests) is `reports/Computer use cost Pareto frontier.html`.
