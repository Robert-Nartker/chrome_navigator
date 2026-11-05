# Independent (third-party) evaluations of computer use and browser use for Claude Opus 5.5, Claude Sonnet 5.5, GPT-6 Astra, GPT-6 Sol / GPT-6.1 Sol and GPT-6 Luna, by reasoning effort

Research date: 2026-09-29. **Method note:** the egress proxy blocked WebFetch and curl for almost every leaderboard domain, including os-world.github.io, hal.cs.princeton.edu, artificialanalysis.ai, vals.ai, snorkel.ai, browser-use.com, steel.dev, llm-stats, benchlm, huggingface, openai.com and x.com. Only GitHub and anthropic.com could be reached. So:
- **Primary data (read directly):** the GitHub repos behind the OSWorld-Verified leaderboard, the Steel.dev leaderboard, the Browser Use benchmark (including its chart images) and OSWorld 2.0. I also read Anthropic's launch pages.
- **Snippet-only data:** everything else, labelled "(search snippet)". Search-engine summaries sometimes merge figures from different pages. I note every conflict I found.

**Release timing matters:**
- GPT-6 Astra launched 2026-09-03 ([Steel data, reportedAt](https://github.com/steel-dev/leaderboard/blob/main/src/data/browsecomp.json)).
- Claude Opus 5.5 and GPT-6 Sol/Luna launched 2026-09-22 ([9to5Google](https://9to5google.com/2026/09/22/claude-opus-5-5-and-openai-gpt-6-sol-luna-both-launch-today-with-lower-costs/)).
- Claude Sonnet 5.5 launched 2026-09-28 ([CellCog](https://cellcog.ai/blog/claude-sonnet-5-5-release-date/); [Anthropic](https://www.anthropic.com/claude-sonnet-5-5)).
- GPT-6.1 Sol replaced GPT-6 Sol "after just 7 days", about 2026-09-29 ([Artificial Analysis article title](https://artificialanalysis.ai/articles/gpt-6-1-sol-replaces-gpt-6-sol-after-just-7-days-with-near-astra-intelligence); [WinBuzzer 2026-09-29](https://winbuzzer.com/2026/09/29/gpt-6-1-sol-model-launches-higher-coding-scores-lower-test-cost-a003-xcxwbn/)).

Most independent computer-use and browser-use boards have not caught up yet.

---

## Q1. Which independent leaderboards have results for these models, and with what settings?

### Takeaway
Only one independent source puts these models on a browser-use score-versus-cost chart: **Browser Use's BU Bench V2** (legacy 60-task cut, chart dated 2026-09-23). It covers GPT-6 Astra (medium), GPT-6 Sol (medium), Opus 5.5 (effort not labelled) and a five-point GPT-6 Luna effort sweep. It has no Sonnet 5.5 and no GPT-6.1 Sol. None of these models appear yet on OSWorld-Verified (XLang), HAL (paused), Steel.dev, Online-Mind2Web, WebVoyager, WebArena or Epoch. Artificial Analysis and Vals.ai have per-effort cost data for all or most of the models, but only on general or agentic composite indices, not on a browser or computer-use benchmark.

### Cited Findings

**OSWorld-Verified official leaderboard (XLang; verified runs)**
- I read the leaderboard data file directly (`static/data/osworld_verified_results.xlsx`, 149 rows; repo HEAD commit 2026-08-08). It has **no entries** for Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-6 Sol, GPT-6.1 Sol or GPT-6 Luna. The latest rows (all 100-step, single rollout, general model, no cost column):
  - `claude-opus-5[1m]` (Anthropic): 83.39% (300.2/360), dated 2026-08-01.
  - `claude-fable-5[1m]`: 85.96% (307.73/358), 2026-08-01.
  - Intelligence-Indeed Agent (agentic framework): 90.19%, 2026-07-25.
  - Coasty CUA v1: 82.81%, 2026-07-01.
  - Muse Spark 1.1: 80.67%, 2026-07-09.
  - `claude-sonnet-4-6`: 72.11%, 2026-03-08.

  Source: [os-world.github.io repo data](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx).
- The leaderboard reports no cost or token figures. Only the step budget (15/50/100), approach type and multiple-rollout flag are recorded ([same file](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx)).
- To appear on the verified leaderboard, submitters must have the maintainers run their agent code on the XLang side ([xlang-ai/OSWorld-v2 README](https://github.com/xlang-ai/OSWorld-v2)).
- Aggregator claims that "Qwen3.8 Max leads OSWorld-Verified with 86.1%" come from Alibaba's self-reported launch table, not the verified sheet ([Steel data osworld.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld.json); [BenchLM search snippet](https://benchlm.ai/benchmarks/osworld-verified)).

**OSWorld 2.0 / 2.1 (Snorkel AI + XLang; 108 long-horizon tasks; partial and binary scores)**
- OSWorld 2.0 has 108 long-horizon workflows that take skilled humans over an hour. It reports both binary completion and a partial score averaged over about 27 checkpoints per task ([Snorkel leaderboard, search snippet](https://snorkel.ai/leaderboard/os-world-2-0/)).
- OSWorld 2.1 was released 2026-09-16 (repo commits "add benchmark release osworld-v2.1") ([xlang-ai/OSWorld-v2](https://github.com/xlang-ai/OSWorld-v2)).
- Snorkel's independent runs (Snorkel co-authored the benchmark), as mirrored by Steel:
  - **Claude Opus 5 at max effort**, batched tools, 500-step budget: **68.31% partial / 31.43% binary**.
  - **GPT-5.6 Sol**, 500-step budget: **62.72% partial / 27.34% binary**.

  Source: [Steel data osworld2.json citing snorkel.ai](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json).
- Snorkel's blog says it ran "three generations" of frontier models, including Opus 5.5. The Opus 5.5 numbers did not appear in any snippet, and the page could not be fetched ([Snorkel blog, search snippet](https://snorkel.ai/blog/osworld-2-0-why-computer-use-agents-fail-most-tasks/)).
- The same snippet says Claude reaches higher accuracy while GPT models are more token-efficient, reaching their lower scores with fewer output tokens ([Snorkel blog, search snippet](https://snorkel.ai/blog/osworld-2-0-why-computer-use-agents-fail-most-tasks/)).
- In the original paper, Claude Opus 4.8 (max thinking, batched tool calls) completes only 20.6% binary at 54.8% partial ([Snorkel, search snippet](https://snorkel.ai/blog/osworld-2-0-why-computer-use-agents-fail-most-tasks/); [Steel osworld2.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json)).
- Simular Sai scores 73.0% partial (28.25% binary) **at $15.70 per task**. This is self-reported by Simular, also a benchmark co-author ([Steel osworld2.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json)).
- **Vendor-reported, not independent (anchors only):**
  - GPT-6 Astra: 72.6% partial on the 2026.08.08 offline subset under a latency simulation, about 40 minutes per task, "maximum at any effort". GPT-5.6 Sol: 65.7% at about 75 minutes. OpenAI's own reproduced Opus 5 run: 70.2% ([Steel osworld2.json citing openai.com/index/gpt-6-astra](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json)).
  - Anthropic, **OSWorld 2.1 partial:** Opus 5.5 81.8%, Fable 5.1 80.7%, Opus 5 74.0% ([Anthropic Opus 5.5 page](https://www.anthropic.com/news/claude-opus-5-5)). Sonnet 5.5 80.1%, Sonnet 5 57.0% ([Anthropic Sonnet 5.5 page](https://www.anthropic.com/claude-sonnet-5-5)).
  - OpenAI GPT-6 Sol/Luna launch: GPT-6 Sol at xhigh scores 60.5% on OSWorld 2.0 offline, against Opus 5 at medium 60.3%, "at approximately 80% lower cost per task". GPT-6 Luna's top score is 52.7%, flat against its predecessor, at about 45% lower cost ([OpenAI, search snippet](https://openai.com/index/introducing-gpt-6-sol-and-luna/)).
  - OpenAI GPT-6.1 Sol launch: 71.4% at max effort at **$1.27 per task**. Astra "still leads by 2.1 points but costs $9.44 per task". GPT-6.1 Sol is 7 points above GPT-6 Sol at max effort at less than half the cost per task ([Vellum / OpenAI, search snippet](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained)). **Conflict:** 71.4 + 2.1 = 73.5, not Astra's launch figure of 72.6. The two posts may use different Astra runs or efforts, or the snippet may be wrong.
  - The same snippet says that on OpenAI's scatter plot, GPT-6.1 Sol's curve "rises steeply between $0.50 and $1.50 per task for the browser agent benchmark". The benchmark is not named in the snippet ([Vellum/OpenAI, search snippet](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained)).

**Browser Use benchmark (BU Bench V2, historical 60-task cut): the only independent browser score-versus-cost chart that includes the target models**
- The README chart "Browser Use Benchmark v2 | Historical 60-task cut | September 23, 2026" plots mean final findings score against recorded agent cost per task on a log scale. It lists 40 model and effort arms ([browser-use/benchmark README + official_plots/bu_bench_v2_astra.jpg](https://github.com/browser-use/benchmark)). The target-model rows (score out of 100, $ per task):
  - GPT-6 Astra (medium): **80.63**, **$8.87**
  - GPT-6 Sol (medium): **66.85**, **$1.20**
  - Opus 5.5 (effort not labelled): **59.40**, **$4.21**
  - GPT-6 Luna (xhigh): **57.55**, **$0.190**
  - GPT-6 Luna (high): **53.95**, **$0.155**
  - GPT-6 Luna (medium): **50.30**, **$0.126**
  - GPT-6 Luna (low): **40.68**, **$0.018**
  - GPT-6 Luna (none): **31.75**, **$0.077**
- Anchors in the same table:
  - Fable 5.1 (high): 56.23, $8.11
  - Opus 5: 50.53, $7.37
  - GPT-5.6 Sol (xhigh): 49.07, $7.80
  - DeepSeek V4.1 Flash (max): 47.88, $0.263
  - GPT-5.6 Luna (xhigh): 41.17, $0.358
  - GPT-5.6 Sol (default): 38.45, $2.71
  - GPT-5.5: 34.90, $2.36
  - Opus 4.8: 27.20, $4.27
  - Gemini 3.1 Pro: 6.88, $0.965

  Source: [bu_bench_v2_astra.jpg](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg).
- The chart footnotes say:
  - The score is "Final weighted rubric credit after judge penalties; not % of tasks solved."
  - The runs are "Historical API runs; no uncertainty intervals."
  - "Original continuation/recovery replacements retained."
  - "Cost covers selected task results; judge, infrastructure and discarded attempts excluded."

  The chart cites `official_results/bu_bench_v2_2026_09_23.json`. That file is **not** in the public repo as of HEAD 2026-09-25; I checked all history ([browser-use/benchmark](https://github.com/browser-use/benchmark)).
- **Discrepancy:** the earlier version of this chart (commit b7e4e4a, 2026-09-09) showed **GPT-6 Astra (medium) at 77.3%**. The 2026-09-23 version shows 80.63 ([commit b7e4e4a vs f691603](https://github.com/browser-use/benchmark/commits/main)).
- The first V2 table (2026-08-26, N=60 per arm) adds median steps, median time and reward-hack rate for anchor models ([bu_bench_v2_light.png](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_light.png)). Target models are not in that table.

  | Arm | Score | $/task | Median steps | Median time | Reward-hack rate |
  |---|---|---|---|---|---|
  | Opus 5 | 50.5% | $7.37 | 86 | 36 min | 12% |
  | GPT-5.6 Sol (xhigh) | 49.1% | $7.80 | 119 | 24 min | 18% |
  | GPT-5.6 Luna (xhigh) | 41.2% | $0.36 | 135 | 22 min | 23% |
  | GPT-5.6 Sol (default) | 38.5% | $2.71 | 70 | 13 min | 28% |
  | GPT-5.6 Luna (default) | 16.1% | $0.06 | 49 | 5 min | 60% |
- **Harness and settings:**
  - The legacy 60-task chart does not name its harness.
  - The current default V2.1 runner (200 tasks) uses BrowserCode 0.1.20 as executor, Browser Use Cloud browsers (one session per task) and a 3,600 s limit per task. The judge is `gpt-5.6-luna` at xhigh. It gives continuous weighted rubric credit, including partial credit.
  - On 2026-09-24 Browser Use made **`openai/gpt-6-luna` at xhigh** the default executor (commit "Default Luna executor reasoning to xhigh (#41)").
  - The README warns that 60-task, 55-task-subset and 200-task scores are not comparable.

  Source: [browser-use/benchmark README](https://github.com/browser-use/benchmark).
- The older BU Bench V1 chart ("Performance of LLMs with BrowserCode", 100 tasks, 2026-08-03) has no target models. Its anchors: Opus 4.8 89.5%, Fable 5 87.0%, Opus 5 87.0%, GPT-5.6 Sol 84.0%, GPT-5.6 Luna (xhigh) 82.0%, GPT-5.6 Luna (default) 72.4% ([browser_harness_by_model_light.png](https://github.com/browser-use/benchmark/blob/main/official_plots/browser_harness_by_model_light.png)).

**Steel.dev browser-agent leaderboard (aggregator of reported results; 14 boards)**
- In the data files at repo HEAD (2026-09-22), none of the WebVoyager, Online-Mind2Web, WebArena, OSWorld, OSWorld 2.0 or BrowseComp boards has a row for Opus 5.5, Sonnet 5.5, GPT-6 Sol, GPT-6.1 Sol or GPT-6 Luna. GPT-6 Astra appears only with vendor numbers: BrowseComp 91.5% (single-agent, max at any effort) and OSWorld 2.0 72.6% ([steel-dev/leaderboard src/data](https://github.com/steel-dev/leaderboard/tree/main/src/data)).
- Online-Mind2Web board leaders, all older models and mostly self-reported:
  - Browser Use Cloud (bu-max): 97.0%, custom judge built on the Claude Agent SDK.
  - GPT-5.4 native computer use: 93.0%, vendor.
  - ABP + Claude Opus 4.6: 90.53%, all 300 task results public.
  - TinyFish: 90.0%.

  Source: [Steel mind2web.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/mind2web.json).
- WebVoyager leader: browser-control (Fable 5), 99.19%, self-reported, 610/615 after exclusions ([Steel webvoyager.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/webvoyager.json)).
- WebArena leader: WebTactix (DeepSeek v3.2), 74.3% ([Steel webarena.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/webarena.json)).
- No BrowseComp-Plus or WebArena-Verified results for the target models turned up in search ([BenchLM BrowseComp search snippet](https://benchlm.ai/benchmarks/browsecomp)).

**HAL (Holistic Agent Leaderboard, Princeton)**
- HAL "has paused updating with new models and is currently focusing on measuring reliability". It no longer accepts new submissions. Its previous results cover frontier models released up to January 2026 ([HAL site, search snippet](https://hal.cs.princeton.edu/); [HAL reliability dashboard](https://hal.cs.princeton.edu/reliability/)). So HAL has **no** Opus 5.5, Sonnet 5.5 or GPT-6 data, on Online Mind2Web or anywhere else.
- HAL's paper ran 21,730 rollouts across 9 models and 9 benchmarks. Online Mind2Web agent runs cost between $171 and over $1,500 per run ([arXiv 2510.11977](https://arxiv.org/abs/2510.11977); search snippet).

**Artificial Analysis (independent; per-effort cost and tokens, but general and agentic composite, not browser-specific)**
- Intelligence Index v4.3.2 is made up of:
  - AA-Briefcase v1.1
  - GDPval-AA v2.1
  - AutomationBench-AA
  - Terminal-Bench 4.0
  - SciCode
  - Humanity's Last Exam
  - GDP.pdf
  - CritPt
  - AA-Omniscience
  - AA-LCR v1.1

  There is no OSWorld or web-browsing agent component ([AA comparison page, search snippet](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-vs-gpt-6-luna-xhigh)).
- The per-effort figures are in Q2 and the consolidated table.

**Vals.ai (independent; Vals Index composite, $ per test)**
- Results (search snippets):
  - Opus 5.5: #1 of 63, 69.69%, at **$32.77 per test**, ahead of Fable 5.1 (68.83%), Opus 5 (67.21%) and GPT-6 Astra (66.61%) ([Vals](https://www.vals.ai/benchmarks/vals_index)).
  - Sonnet 5.5: evaluated 2026-09-28, 67.04% ([Vals comparison](https://www.vals.ai/comparisons/anthropic_claude-sonnet-5-5-vs-openai_gpt-6-sol)).
  - GPT-6 Sol: #8 of 65, 62.57%, at $7.56 per test.
  - GPT-6 Luna: #20 of 65, 58.45%, at **$0.42 per test** ([Vals GPT-6 Luna](https://www.vals.ai/models/openai_gpt-6-luna)).
- I found no Vals browser-use or computer-use benchmark. Snippets do not give effort levels.
- The snippets disagree on who ranks first: one says Sonnet 5.5 ranks "at the top", another puts Opus 5.5 at #1 with 69.69%.

**Epoch AI**
- Epoch's September 2026 ECI gives GPT-6 Astra 167, ranked first of 251 models.
- Epoch had not published an Opus 5.5 index by 2026-09-29.
- The Epoch hub runs GPQA and SWE-bench Verified itself and mirrors other boards. No OSWorld or browser runs for these models were found.

Source: [search snippet via Second Talent / Epoch](https://www.secondtalent.com/resources/gpt-6-vs-claude-vs-gemini/).

**ScreenSpot-Pro, AndroidWorld, LMArena, BrowserArena, Halluminate**
- ScreenSpot-Pro: GPT-6 Astra 92.7%, Fable 5 87.3%, GPT-5.6 Sol 76.9%. These are vendor numbers relayed by aggregators. Anthropic did not publish an Opus 5.5 figure ([BenchLM ScreenSpot-Pro, search snippet](https://benchlm.ai/benchmarks/screenspot-pro)).
- I found no AndroidWorld, LMArena agent-arena, BrowserArena or Halluminate (Web Bench / Westworld) results for any target model ([Halluminate Westworld](https://www.halluminate.ai/blog/westworld); searches returned only GPT-5.x-era references).

**BrowseComp (vendor-reported only)**
- GPT-6 Astra: 91.5%, single agent, max at any effort.
- Claude Opus 5: 90.8%, max effort, compaction at 200k; OpenAI's table lists the same figure.
- Claude Sonnet 5: 84.7%.
- GPT-5.6 Sol Ultra (4 parallel agents): 92.2%.

No Opus 5.5, Sonnet 5.5, GPT-6 Sol/6.1 Sol or Luna BrowseComp figures were found ([Steel browsecomp.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/browsecomp.json)).

### Inferences
- For browser use, the only independent Pareto chart covering these models is BU Bench V2 (legacy 60 tasks). On it, **GPT-6 Luna (low→xhigh) and GPT-6 Sol (medium) form the low-cost frontier, and GPT-6 Astra (medium) is the high end**. **Opus 5.5 at $4.21 scores below GPT-6 Sol at $1.20**, so it sits off (dominated by) the frontier on this benchmark. That rests on a single Browser Use–run arm with an unstated effort level, so treat it cautiously.
- The OSWorld-family numbers for Opus 5.5 and Sonnet 5.5 (81.8% and 80.1% partial on OSWorld 2.1) and for GPT-6 Sol/6.1 Sol/Luna (OSWorld 2.0 offline) come from the vendors, on **different OSWorld versions** (2.0 offline subset versus 2.1). They cannot be put on one chart as independent points.
- Most of the gap is timing: GPT-6.1 Sol is about 0 days old, Sonnet 5.5 1 day, Opus 5.5 and GPT-6 Sol/Luna 7 days. Leaderboards that re-run models (OSWorld-Verified, Snorkel OSWorld 2.0) usually lag launches by weeks.

### Gaps
- I could not get Snorkel's OSWorld 2.0/2.1 leaderboard entries for Opus 5.5 or any GPT-6 model; snorkel.ai was blocked and the snippets gave no figures.
- The BU Bench V2 per-arm data file (`bu_bench_v2_2026_09_23.json`) is not public. Opus 5.5's effort level, token counts, step counts and times for the new arms are unknown.
- Sonnet 5.5 and GPT-6.1 Sol have no independent browser or computer-use result anywhere I could find.
- I found no Stagehand/Browserbase agent-eval figures for the target models; stagehand.dev was blocked and snippets returned nothing specific.

---

## Q2. Details per data point: benchmark variant, harness, step budget, pass@1, effort, score, cost, tokens, date

### Takeaway
BU Bench V2 is the only independent source that pairs browser-use scores with dollars per task for these models. Artificial Analysis supplies the best independent per-effort **cost and token** curves for all five model families, but on a general and agentic index, not on browser tasks. The OSWorld figures that carry costs are vendor-reported.

### Cited Findings

**Artificial Analysis Intelligence Index, per effort (search snippets)**
- **Claude Opus 5.5:**
  - Max: index 58 (#1), **$5.98 per Intelligence Index task**, about **119k output tokens per task**.
  - Low: $0.55 per task.
  - High: 53M tokens generated over the index. Medium: 38M.
  - Max, xhigh, high and medium all sit on AA's intelligence-versus-cost-per-task frontier.
  - Pricing is $4/$20 per million input/output tokens, down from $5/$25 for Opus 5.

  Sources: [AA Opus 5.5 article](https://artificialanalysis.ai/articles/claude-opus-5-5); [AA on X](https://x.com/ArtificialAnlys/status/2102541956014657615).

  Medium costs about **$1.34 per task** on AA's measurement (secondary source quoting AA: [Medium/AI Trends 24](https://medium.com/@aitrends24/opus-5-5-quietly-ignores-your-effort-setting-i-checked-what-all-5-levels-actually-cost-4adf83d8e9c8); [FinOps LLM](https://finopsllm.com/research/opus-5-5-effort-level-cost)).
- **Claude Sonnet 5.5:**
  - Max with default fallback: index 56 (#2 or #3 depending on snapshot), **$7.60 per task** against $5.09 for Sonnet 5 at max. About **193k output tokens per task** and 410M output tokens across the index; the class median is 88M.
  - Medium: about **$0.83 per task**.
  - At max, Sonnet 5.5 "costs more than Opus 5.5 max and scores lower".

  Sources: [AA Sonnet 5.5 article](https://artificialanalysis.ai/articles/claude-sonnet-5-5); [AA on X](https://x.com/ArtificialAnlys/status/2104640155843989864); [OrcaRouter](https://www.orcarouter.ai/blog/claude-sonnet-5-5-cost-per-task); [TokenCost](https://tokencost.app/blog/claude-sonnet-5-5-pricing).

  List price is $2/$10 per million tokens ([Unite.AI](https://www.unite.ai/anthropic-releases-claude-sonnet-5-5-at-unchanged-sonnet-5-pricing/)).
- **GPT-6 Astra:** max scores 53, **$3.26 per task**, 60M tokens, against a median of 85M ([AA GPT-6 Astra page, search snippet](https://artificialanalysis.ai/models/gpt-6-astra)). Opus 5.5 at 58 against Astra at 53 on AA is repeated in [Artificial Analysis comparison, search snippet](https://artificialanalysis.ai/models/releases/comparisons/claude-opus-5-5-vs-gpt-6-astra). **Conflicts:**
  - Another snippet says Astra costs "$0.46 per task at low to $1.67 at max… score 57 to 61" and "xhigh to max adds nothing but raises cost ~40%".
  - Another says "lowest cost tier is GPT-6 Astra (low) at $0.82".
  - These may come from third-party blogs or an older index version and could not be verified ([search results page listing AA/ML6/KbWen](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra)).
- **GPT-6.1 Sol:**

  | Effort | Index | $/task | Tokens over index |
  |---|---|---|---|
  | max | 52 | $0.72 | 67M |
  | high | 50 | $0.32 | 25M |
  | medium | 48 | $0.21 | 15M |

  Pricing is $2/$10 per million tokens. GPT-6.1 Sol scores 1 point below GPT-6 Astra at under a quarter of the cost per task ([AA GPT-6.1 Sol pages](https://artificialanalysis.ai/models/releases/gpt-6-1-sol); [AA on X](https://x.com/ArtificialAnlys/status/2105025585332605357)).
- **GPT-6 Sol (xhigh):** index 44, $0.53 per task, 40M tokens ([AA GPT-6 Sol xhigh](https://artificialanalysis.ai/models/gpt-6-sol-xhigh)).
- **GPT-6 Luna:**
  - max: 37, $0.07 per task
  - xhigh: 34
  - low: $0.0045 per task

  Source: [AA Luna comparison pages](https://artificialanalysis.ai/models/gpt-6-luna); [AA comparison](https://artificialanalysis.ai/models/comparisons/claude-sonnet-5-5-vs-gpt-6-luna-xhigh).

**Agentic workflow benchmark with cost (AutomationBench, Zapier; also an AA sub-benchmark). API tool use, not a browser**
- GPT-6 Sol at xhigh: **33.2% at $0.27 per task**, beating Opus 5 at max (26.9%) at "11.1x the cost". That implies about $3.0 per task for Opus 5; this is my arithmetic ([search snippet, Kingy AI](https://kingy.ai/blog/gpt-6-sol-luna-specs-benchmarks-pricing-comparison/)).
- GPT-6.1 Sol: 32.0% at "higher reasoning settings" against Opus 5.5 with fallbacks at 28.8%, "cutting task cost by more than 50%" ([search snippet, Kingy/Vellum](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/)).
- A separate snippet gives **Astra 41.4% against Opus 5.5 40.0%** ([Vellum/Kingy snippet](https://www.vellum.ai/blog/claude-opus-5-5-vs-gpt-6-astra)).
- **Conflict:** Opus 5.5 appears at 28.8% and at 40.0%. This is probably different effort levels, but that is not confirmed.
- Anthropic says Opus 5.5 outscores Opus 5 and GPT-5.6 Sol on AutomationBench at every effort level (vendor chart, [Anthropic](https://www.anthropic.com/news/claude-opus-5-5)).

**Terminal-Bench-Science 0.1 (vendor, via OpenAI's GPT-6.1 Sol launch; agentic, not browser)**
- At max effort, GPT-6.1 Sol costs **$5.47 per task** against **$23.21 for Opus 5.5** and **$23.80 for Astra** ([search snippet, Vellum/OpenAI](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained); [beri.net](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task)).
- Anthropic's own table gives Opus 5.5 58.7% on this benchmark ([Anthropic](https://www.anthropic.com/news/claude-opus-5-5)).

**OSWorld-Verified step-budget anchor (XLang, independent)**
- `claude-sonnet-4-5-20250929`: 42.88% at 15 steps, 58.08% at 50 steps, 62.88% at 100 steps. This is the only same-model step-budget sweep on the verified sheet from a recent Claude model ([OSWorld-Verified xlsx](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx)).

### Inferences
- To place Opus 5.5 and Sonnet 5.5 on a browser Pareto chart with independent data, one option is BU Bench V2's single Opus 5.5 point ($4.21 → 59.4) plus AA's effort-cost multipliers as an **estimate**. For Opus 5.5, AA shows max costing about 4.5× medium and about 11× low. That would be an estimate, not measured browser data.
- Snippet cost-per-task figures are not comparable across AA ($ per index task), Vals ($ per test), BU Bench ($ agent API cost per browser task, judge excluded) and vendor charts ($ per attempt). Keep them on separate charts.

### Gaps
- AA scores per effort for Opus 5.5 low, medium, high and xhigh, and for Sonnet 5.5 low, medium, high and xhigh, were not in the snippets. Only costs and token totals were.
- The GPT-6 Astra AA figures conflict ($3.26 against $1.67 at max).
- No token counts are published for BU Bench V2.

---

## Q3. Independent comparisons of reasoning-effort levels on agentic or browser tasks: diminishing returns?

### Takeaway
The clearest independent **browser** effort sweep is Browser Use's GPT-6 Luna curve:

| Luna effort | Score | $/task |
|---|---|---|
| none | 31.8 | $0.077 |
| low | 40.7 | $0.018 |
| medium | 50.3 | $0.126 |
| high | 54.0 | $0.155 |
| xhigh | 57.5 | $0.190 |

- The biggest jump is low→medium (+9.6 points).
- Each later step adds about 3.6 points for about $0.03 more.
- Returns diminish in points per step but stay cheap in absolute dollars.
- Browser Use made Luna xhigh its default executor.

On general and agentic indices (Artificial Analysis), top efforts show strong diminishing returns: GPT-6.1 Sol medium→max is +4 index points for 3.4× the cost and 4.5× the tokens. Sonnet 5.5 at max is dominated by Opus 5.5.

### Cited Findings
- **BU Bench V2 GPT-6 Luna sweep** (legacy 60 tasks, weighted rubric score, agent-only cost): none 31.75 ($0.077); low 40.68 ($0.018); medium 50.30 ($0.126); high 53.95 ($0.155); xhigh 57.55 ($0.190) ([browser-use/benchmark chart](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg)).
- The oddity is that "none" costs more than "low" while scoring lower. The chart does not explain it. Possibly more steps or recovery replacements; that is my inference.
- **BU Bench V2, older-model effort pairs** in the same table:
  - GPT-5.6 Sol default→xhigh: 38.45 → 49.07 (+10.6), $2.71 → $7.80 (2.9×).
  - GPT-5.6 Luna default→xhigh: 16.05 → 41.17, $0.056 → $0.358 (6.4×).
  - Median steps grew from 70 to 119 for Sol and from 49 to 135 for Luna.

  Sources: [bu_bench_v2_astra.jpg](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg); [bu_bench_v2_light.png](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_light.png).
- Browser Use set the default V2.1 executor to `openai/gpt-6-luna` at xhigh on 2026-09-24 ([commit 8bf173d "Default Luna executor reasoning to xhigh (#41)"](https://github.com/browser-use/benchmark/commits/main)).
- **Artificial Analysis, GPT-6.1 Sol:** medium 48 ($0.21, 15M tokens) → high 50 ($0.32, 25M) → max 52 ($0.72, 67M) ([AA](https://artificialanalysis.ai/models/releases/gpt-6-1-sol)).
- **Artificial Analysis, Opus 5.5:** low $0.55 → medium about $1.34 → max $5.98 per task, about 4.5× from medium to max. Four of five effort levels sit on AA's cost frontier ([AA Opus 5.5](https://artificialanalysis.ai/articles/claude-opus-5-5); [FinOps LLM](https://finopsllm.com/research/opus-5-5-effort-level-cost)).
- **Artificial Analysis, Sonnet 5.5:** max is the most token-hungry setting AA has seen, at about 193k output tokens per task, and is dominated by Opus 5.5 at max. At medium and high, Sonnet 5.5 is more than 40% cheaper than Sonnet 5 and scores 13–15 points higher ([AA / OrcaRouter / Kingy, search snippets](https://artificialanalysis.ai/articles/claude-sonnet-5-5)).
- Anthropic (vendor) says Sonnet 5.5 scores lower at Max than at Xhigh on FrontierCode ([Anthropic Sonnet 5.5 footnote 2](https://www.anthropic.com/claude-sonnet-5-5)).
- A third-party snippet says Astra xhigh→max "adds nothing to the intelligence score but raises the cost by roughly 40%". The source is unverified ([search result set](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra)).
- An independent token measurement found Astra at xhigh used 1.76× medium's tokens for refactoring and 2.52× for a mobile redesign ([Trilogy AI substack](https://trilogyai.substack.com/p/astra-reasoning-effort-token-usage)).
- In the academic paper "The Reasoning Tax", raising the reasoning budget beyond a moderate level gives sharply diminishing marginal token efficiency and sometimes **negative** marginal accuracy ([arXiv 2608.26235, search snippet](https://arxiv.org/pdf/2608.26235)).
- **Step budget as the analogous knob:** on OSWorld-Verified, Sonnet 4.5 goes 42.9% (15 steps) → 58.1% (50) → 62.9% (100). That is +15.2 points for the first 35 extra steps and +4.8 for the next 50 ([OSWorld-Verified xlsx](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx)).
- Snorkel reports that on OSWorld 2.0, GPT models reach their (lower) results with fewer output tokens than Claude ([Snorkel blog, search snippet](https://snorkel.ai/blog/osworld-2-0-why-computer-use-agents-fail-most-tasks/)).

### Inferences
- For browser agents, the independent evidence (BU Bench) suggests the small or cheap model's effort curve (Luna) stays worth climbing up to xhigh because the absolute cost is tiny. For frontier models, the step up from default to xhigh roughly triples cost for about 10 points (GPT-5.6 Sol).
- No independent browser benchmark yet sweeps Opus 5.5, Sonnet 5.5, Astra or GPT-6.1 Sol effort levels. Claims about their diminishing returns on browser tasks would have to be extrapolated from AA's general index. Label that as an estimate.

### Gaps
- There is no independent effort sweep for Opus 5.5, Sonnet 5.5, Astra, GPT-6 Sol or GPT-6.1 Sol on any browser or computer-use benchmark.
- Snorkel's per-effort OSWorld 2.0 data, if any exists, could not be read.

---

## Q4. Practitioner reports with measured browser-agent success rate and cost

### Takeaway
I found **no** practitioner report (blog, GitHub issue, Reddit, X) with a measured browser-agent success rate **and** cost for the target models. The practitioner material that exists is about effort and cost on coding or knowledge tasks, often repackaging vendor or AA numbers. One report flags a Claude Code configuration pitfall that can silently change Opus 5.5's effort.

### Cited Findings
- **Claude Code effort pitfall:** effort is now stored per model. A legacy top-level `/effort` key "no longer applies to newly released models such as Opus 5.5" (Claude Code changelog 2.1.280, quoted). On Opus 5.5, thinking cannot be turned off; effort (low, medium, high, xhigh, max) is the only control ([Medium/AI Trends 24](https://medium.com/@aitrends24/opus-5-5-quietly-ignores-your-effort-setting-i-checked-what-all-5-levels-actually-cost-4adf83d8e9c8); [aifreeapi effort sweep](https://www.aifreeapi.com/en/posts/claude-opus-5-5-effort)).
- A developer write-up argues "the effort knob matters more than the model". Its figures are Opus 5.5 medium 57.6% at $2.94 per attempt against Astra high 57.9% at $7.21. These appear to be **Terminal-Bench 4.0 vendor-chart numbers**, not browser tasks ([DEV Community](https://dev.to/genelab_999/claude-opus-55-vs-gpt-6-astra-vs-gpt-6-sol-the-effort-knob-matters-more-than-the-model-55gm)). A related snippet has medium 57.6% at about $2.94 and high 64.2% at about $3.88 on Terminal-Bench 4.0 ([search snippet](https://pub.towardsai.net/xhigh-vs-high-one-effort-level-crushed-the-agent-testing-tool-by-61-points-2fa3bc284343)).
- Early-tester quotes on Anthropic's page (vendor-curated, not browser-specific) include:
  - Viktor: "At the same effort, Opus 5.5 needs fewer steps and tool calls per task than Opus 5 and costs nearly half as much."
  - Factory: medium matched Opus 5 high with 20–25% fewer output tokens.

  Source: [Anthropic](https://www.anthropic.com/news/claude-opus-5-5).
- On safety rather than success, Sonnet 5.5 had zero successful browser-use prompt-injection attacks (0 of 110 without safeguards) in Anthropic's testing ([search snippet, ComputingForGeeks](https://computingforgeeks.com/claude-sonnet-5-5-released-features-benchmarks/)).
- The Online-Mind2Web board shows how practitioner systems differ from bare models. ABP + Opus 4.6 reached 90.53% with all 300 task results public. Browser Use Cloud bu-max reached 97.0% using its own Claude-Agent-SDK judge ([Steel mind2web.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/mind2web.json)).

### Inferences
- Browser-agent cost is highly sensitive to harness defaults: step caps, effort setting, and whether configured effort actually reaches the model. Practitioner measurements of Opus 5.5 run through Claude Code or Claude in Chrome may not reflect the effort the user thinks they set.

### Gaps
- There are no Reddit, X or GitHub-issue reports with measured browser success rate plus cost for Opus 5.5, Sonnet 5.5, GPT-6 Astra, GPT-6 Sol/6.1 Sol or Luna (with Browser Use, Stagehand, Playwright MCP, Claude in Chrome or OpenAI agent mode). x.com and reddit were not reachable, and searches returned none.
- I found no Stagehand/Browserbase, Skyvern, MultiOn or Halluminate numbers for these models.

### Consolidated table

Rows are independent unless marked VENDOR. Scores are as published. "—" means not available. Snip = figure seen only in a search snippet.

| model | effort | benchmark (exact variant + harness + step budget) | score | $ per task or total $ | tokens | evaluator + URL | date | notes |
|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra | medium | BU Bench V2, legacy 60-task cut; Browser Use Cloud browsers; harness not stated on chart (V2 runner = BrowserCode); findings-rubric judge; single run | 80.63 (weighted rubric /100) | $8.87 (agent API only) | — | Browser Use — [github.com/browser-use/benchmark](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_astra.jpg) | chart 2026-09-23 | Sep-9 chart version showed 77.3%; not % solved; no CIs |
| GPT-6 Sol | medium | BU Bench V2 legacy 60 (as above) | 66.85 | $1.20 | — | Browser Use (same) | 2026-09-23 | Frontier point between Luna and Astra |
| Claude Opus 5.5 | not labelled | BU Bench V2 legacy 60 (as above) | 59.40 | $4.21 | — | Browser Use (same) | 2026-09-23 | Dominated by GPT-6 Sol medium on this chart |
| GPT-6 Luna | xhigh | BU Bench V2 legacy 60 | 57.55 | $0.190 | — | Browser Use (same) | 2026-09-23 | Browser Use's new default executor (2026-09-24) |
| GPT-6 Luna | high | BU Bench V2 legacy 60 | 53.95 | $0.155 | — | Browser Use (same) | 2026-09-23 | |
| GPT-6 Luna | medium | BU Bench V2 legacy 60 | 50.30 | $0.126 | — | Browser Use (same) | 2026-09-23 | |
| GPT-6 Luna | low | BU Bench V2 legacy 60 | 40.68 | $0.018 | — | Browser Use (same) | 2026-09-23 | Cheapest point on chart |
| GPT-6 Luna | none | BU Bench V2 legacy 60 | 31.75 | $0.077 | — | Browser Use (same) | 2026-09-23 | Costs more than "low" |
| Claude Fable 5.1 (anchor) | high | BU Bench V2 legacy 60 | 56.23 | $8.11 | — | Browser Use (same) | 2026-09-23 | |
| Claude Opus 5 (anchor) | not labelled | BU Bench V2 legacy 60 | 50.53 | $7.37 | — | Browser Use (same); [Aug table](https://github.com/browser-use/benchmark/blob/main/official_plots/bu_bench_v2_light.png) | 2026-08-26 / 09-23 | Median 86 steps, 36 min; 12% reward-hack |
| GPT-5.6 Sol (anchor) | xhigh / default | BU Bench V2 legacy 60 | 49.07 / 38.45 | $7.80 / $2.71 | — | Browser Use (same) | 2026-08-26 / 09-23 | Median steps 119 / 70 |
| GPT-5.6 Luna (anchor) | xhigh / default | BU Bench V2 legacy 60 | 41.17 / 16.05 | $0.358 / $0.056 | — | Browser Use (same) | 2026-08-26 / 09-23 | Median steps 135 / 49 |
| Claude Opus 5 (anchor) | max | OSWorld 2.0, 500-step budget, batched tools; partial / binary | 68.31% / 31.43% | — | — | Snorkel AI (co-author) via [Steel osworld2.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json) → [snorkel.ai](https://snorkel.ai/leaderboard/os-world-2-0/) | 2026-09 | Independent run; Opus 5.5 run reported but figures not visible |
| GPT-5.6 Sol (anchor) | not stated | OSWorld 2.0, 500-step; partial / binary | 62.72% / 27.34% | — | — | Snorkel AI (same) | 2026-09 | |
| Simular Sai (agent, anchor) | — | OSWorld 2.0; partial / binary | 73.0% / 28.25% | $15.70/task | — | Simular (self-report, co-author) via [Steel](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json) | 2026-08-28 | Only OSWorld 2.0 entry with $/task outside vendors |
| claude-opus-5[1m] (anchor) | not stated | OSWorld-Verified, 361 tasks, 100 steps, single rollout, general model | 83.39% (300.2/360) | — | — | XLang verified — [os-world.github.io xlsx](https://github.com/os-world/os-world.github.io/blob/main/static/data/osworld_verified_results.xlsx) | 2026-08-01 | No target models on sheet (HEAD 2026-08-08) |
| claude-fable-5[1m] (anchor) | not stated | OSWorld-Verified, 100 steps | 85.96% (307.73/358) | — | — | XLang (same) | 2026-08-01 | |
| claude-sonnet-4-5 (anchor) | not stated | OSWorld-Verified, 15 / 50 / 100 steps | 42.88 / 58.08 / 62.88% | — | — | XLang (same) | 2025-10-31 | Step-budget returns curve |
| Claude Opus 5.5 | max | AA Intelligence Index v4.3.2 (composite incl. AutomationBench-AA, GDPval-AA, Terminal-Bench 4.0; not browser) | 58 | $5.98 / index task | ~119k output tok/task | Artificial Analysis — [article](https://artificialanalysis.ai/articles/claude-opus-5-5) | 2026-09-22+ | Snip |
| Claude Opus 5.5 | medium / high / low | AA Intelligence Index | not in snippets | ~$1.34 (med, via secondary) / — / $0.55 (low) | 38M (med), 53M (high) total | AA — [finopsllm](https://finopsllm.com/research/opus-5-5-effort-level-cost), [AA](https://artificialanalysis.ai/models/claude-opus-5-5-medium) | 2026-09 | Snip; max/xhigh/high/med all on AA frontier |
| Claude Sonnet 5.5 | max (default fallback) | AA Intelligence Index | 56 | $7.60 / index task | ~193k output tok/task; 410M output total | AA — [article](https://artificialanalysis.ai/articles/claude-sonnet-5-5) | 2026-09-28+ | Snip; dominated by Opus 5.5 max |
| Claude Sonnet 5.5 | medium | AA Intelligence Index | not in snippets | ~$0.83 / index task | — | AA via [OrcaRouter](https://www.orcarouter.ai/blog/claude-sonnet-5-5-cost-per-task) | 2026-09 | Snip |
| GPT-6 Astra | max | AA Intelligence Index | 53 | $3.26 / index task | 60M total | AA — [model page](https://artificialanalysis.ai/models/gpt-6-astra) | 2026-09 | Snip; conflicting snippet says $1.67 at max, $0.46 at low |
| GPT-6.1 Sol | max / high / medium | AA Intelligence Index | 52 / 50 / 48 | $0.72 / $0.32 / $0.21 | 67M / 25M / 15M total | AA — [release page](https://artificialanalysis.ai/models/releases/gpt-6-1-sol) | ~2026-09-29 | Snip |
| GPT-6 Sol | xhigh | AA Intelligence Index | 44 | $0.53 / index task | 40M total | AA — [model page](https://artificialanalysis.ai/models/gpt-6-sol-xhigh) | 2026-09-22+ | Snip; superseded by 6.1 |
| GPT-6 Luna | max / xhigh / low | AA Intelligence Index | 37 / 34 / — | $0.07 / — / $0.0045 | — | AA — [model page](https://artificialanalysis.ai/models/gpt-6-luna) | 2026-09-22+ | Snip |
| Claude Opus 5.5 | not stated | Vals Index (composite, not browser) | 69.69% (#1/63) | $32.77 / test | — | Vals.ai — [vals_index](https://www.vals.ai/benchmarks/vals_index) | 2026-09 | Snip |
| Claude Sonnet 5.5 | not stated | Vals Index | 67.04% | — | — | Vals.ai — [comparison](https://www.vals.ai/comparisons/anthropic_claude-sonnet-5-5-vs-openai_gpt-6-sol) | 2026-09-28 | Snip; conflicting rank claims |
| GPT-6 Astra | not stated | Vals Index | 66.61% | — | — | Vals.ai (same) | 2026-09 | Snip |
| GPT-6 Sol | not stated | Vals Index | 62.57% (#8/65) | $7.56 / test | — | Vals.ai (same) | 2026-09 | Snip |
| GPT-6 Luna | not stated | Vals Index | 58.45% (#20/65) | $0.42 / test | — | Vals.ai — [Luna](https://www.vals.ai/models/openai_gpt-6-luna) | 2026-09 | Snip |
| GPT-6 Sol | xhigh | AutomationBench (Zapier business workflows; API apps, not browser) | 33.2% | $0.27/task | — | reported via [Kingy AI](https://kingy.ai/blog/gpt-6-sol-luna-specs-benchmarks-pricing-comparison/) (likely VENDOR chart) | 2026-09-22 | Snip; Opus 5 max 26.9% at 11.1× cost (≈$3.0, derived) |
| GPT-6.1 Sol vs Claude Opus 5.5 | "higher" / with fallbacks | AutomationBench | 32.0% vs 28.8% | 6.1 Sol >50% cheaper | — | via [Kingy AI](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/) (likely VENDOR) | ~2026-09-29 | Snip; conflicts with Astra 41.4% vs Opus 5.5 40.0% snippet |
| GPT-6 Astra | max at any effort | OSWorld 2.0, 2026.08.08 offline subset, latency sim (~40 min/task); partial | 72.6% | $9.44/task (per GPT-6.1 Sol launch snip) | — | VENDOR OpenAI — [Steel osworld2.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/osworld2.json) | 2026-09-03 | Not independent |
| GPT-6.1 Sol | max | OSWorld 2.0 offline; partial | 71.4% | $1.27/task | — | VENDOR OpenAI via [Vellum snippet](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained) | ~2026-09-29 | Snip; "Astra +2.1 pts" is inconsistent with 72.6 |
| GPT-6 Sol | xhigh | OSWorld 2.0 offline; partial | 60.5% | ~80% below Opus 5 (medium, 60.3%) | — | VENDOR OpenAI — [snippet](https://openai.com/index/introducing-gpt-6-sol-and-luna/) | 2026-09-22 | Snip |
| GPT-6 Luna | max (top score) | OSWorld 2.0 offline; partial | 52.7% | ~45% below GPT-5.6 Luna | — | VENDOR OpenAI — [snippet](https://openai.com/index/introducing-gpt-6-sol-and-luna/) | 2026-09-22 | Snip |
| Claude Opus 5.5 | adaptive thinking (level not captured) | OSWorld 2.1; partial | 81.8% | — | — | VENDOR Anthropic — [anthropic.com](https://www.anthropic.com/news/claude-opus-5-5) | 2026-09-22 | Different version from OpenAI's 2.0 offline |
| Claude Sonnet 5.5 | not captured | OSWorld 2.1; partial | 80.1% | — | — | VENDOR Anthropic — [anthropic.com](https://www.anthropic.com/claude-sonnet-5-5) | 2026-09-28 | Sonnet 5 = 57.0% |
| GPT-6 Astra | max at any effort | BrowseComp, single agent | 91.5% | — | — | VENDOR OpenAI via [Steel browsecomp.json](https://github.com/steel-dev/leaderboard/blob/main/src/data/browsecomp.json) | 2026-09-03 | No BrowseComp figures found for other targets |
| GPT-6 Astra | not stated | ScreenSpot-Pro (grounding) | 92.7% | — | — | VENDOR via [BenchLM snippet](https://benchlm.ai/benchmarks/screenspot-pro) | 2026-09 | Opus 5.5 not published |
| Opus 5.5 / GPT-6.1 Sol / GPT-6 Astra | max | Terminal-Bench-Science 0.1 (agentic, not browser) | Opus 5.5 58.7% (Anthropic table) | $23.21 / $5.47 / $23.80 per task | — | VENDOR OpenAI via [beri.net snippet](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task) | ~2026-09-29 | Snip; cost-only anchor |
