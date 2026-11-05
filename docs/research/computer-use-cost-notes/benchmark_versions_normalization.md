# Computer-use and browser-use benchmark versions, settings, and score normalization (crosswalk as of 2026-09-29)

Scope: how to put Claude Opus 5.5, Claude Sonnet 5.5, GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna, whose results come from different benchmark variants, onto one comparable scale.

Access note: arxiv.org, openai.com, epoch.ai, snorkel.ai, osworld-v2.xlang.ai, huggingface.co, vellum.ai, benchlm.ai, llm-stats.com, leaderboard.steel.dev, paperswithcode.co and www-cdn.anthropic.com (system-card PDFs) were all blocked by the egress proxy. Primary data came from:
- GitHub: the xlang-ai/OSWorld-V2 repo (README, release manifests, and task lists), the os-world.github.io repo (the official OSWorld-Verified results spreadsheet, commit dated 2026-08-08), the steel-dev/leaderboard repo (curated JSON with per-entry methodology notes, commit dated 2026-09-22), epoch-research/eci-public, and the READMEs for BrowseComp-Plus, Online-Mind2Web, WebArena-Verified, BU Bench and Westworld.
- Copies of the Anthropic Opus 5.5 and Sonnet 5.5 launch pages.
- Search-engine snippets. Anything sourced only from snippets or aggregators is marked "(snippet)".

---

## 1. OSWorld family: variants, what changed, step budgets, human baseline, observation modes, and paired numbers

### Takeaway
Three OSWorld generations are in use:
- **OSWorld (2024; 369 tasks)**.
- **OSWorld-Verified (July 2025; 361 tasks; more than 300 fixes)**, which is now saturated. The best general model scores about 86%, above the 72.36% human baseline.
- **OSWorld 2.0 (June 2026; 108 long-horizon tasks, partial and strict scores; an 82-task "offline" subset; point releases 2026.06.24 and 2026.08.08, then 2.1 on 2026-09-16)**, which still discriminates at the frontier.

The five target models were not reported on the same OSWorld variant:
- Anthropic reports **OSWorld 2.1 partial**: Opus 5.5 81.8%, Sonnet 5.5 80.1%.
- OpenAI reports **OSWorld 2.0 offline-subset partial (0808 release) with latency simulation**: Astra 72.6%, GPT-6.1 Sol 71.4%, Luna 52.7% (Luna disputed).

Claude Opus 5 appears in both vendors' tables and is the only usable bridge. It implies OpenAI-offline → Anthropic-2.1 ≈ +3.8 pp, or +0.19 logits.

### Cited Findings

**Original OSWorld (2024)**
- 369 tasks on real desktop and web apps. The human success rate is 72.36%. The best agent at publication scored 12.24% (GPT-4 with accessibility-tree input) — [OSWorld paper / project page](https://os-world.github.io/) (snippet); [NeurIPS 2024 paper](https://proceedings.neurips.cc/paper_files/paper/2024/file/5d413e48f84dc61244b6be550f1cd8f5-Paper-Datasets_and_Benchmarks_Track.pdf) (snippet).
- There are four observation settings: screenshot, accessibility (a11y) tree, screenshot + a11y tree, and Set-of-Mark (SoM). Scores from the official self-reported sheets (a11y / screenshot / ss+a11y / SoM) — [os-world.github.io data, self_reported_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data):

  | Model | A11y tree | Screenshot | Screenshot + a11y | Set-of-Mark |
  |---|---|---|---|---|
  | GPT-4 | 12.24 | — | — | — |
  | GPT-4V | — | 5.26 | 12.17 | 11.77 |
  | GPT-4o | 11.36 | 5.03 | 11.21 | 4.59 |
  | Claude 3 Opus | — | 2.42 | 4.41 | 6.72 |

  In 2024, adding the a11y tree roughly doubled GPT-class scores compared with screenshot-only input.
- Pre-Verified vendor self-reports also varied the step budget. Anthropic's Claude 3.7 Sonnet self-reports were about 15.5 / 26 / 28 at 15 / 50 / 100 steps. OpenAI's CUA was 19.7 at 15 steps and 38.1 at 200 steps. OpenAI CUA o3 was 42.9 at 200 steps — [self_reported_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data).

**OSWorld-Verified (2025-07-28)**
- The team fixed more than 300 issues: changes in web structure, ambiguous instructions, and fragile evaluators. They also moved from VMware/Docker to AWS with up to 50 parallel environments. Maintainers ask for OSWorld results to be compared "with the new benchmark results when running the latest version" — [xlang-ai/OSWorld README](https://github.com/xlang-ai/OSWorld); [XLANG blog](https://xlang.ai/blog/osworld-verified) (snippet).
- The official Verified runs are scored on up to 361 tasks: the denominator reads "x/361", with 8 Google-Drive tasks excluded. Every official row records the step budget (15, 50, 100 or 150), whether the a11y tree was used, coded actions, and multiple rollouts. Almost all 2025–26 frontier rows are screenshot-only with no a11y tree — [osworld_verified_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data).
- Top official Verified rows as of 2026-08-08:
  - Intelligence-Indeed Agent (a framework with coded actions): 90.19 at 100 steps.
  - claude-fable-5[1m]: 85.96, 100 steps, 2026-08-01.
  - Pointer Agent w/ Opus 4.7: 83.64.
  - claude-opus-5[1m]: 83.39, 100 steps, 2026-08-01.
  - Muse Spark 1.1: 80.67.
  - MiniMax M3: 75.19.
  - Qwen 3.7 Plus: 73.3.
  - Kimi K2.6: 73.06.
  - claude-sonnet-4-6: 72.11.

  Source: [osworld_verified_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data).
- Vendor self-reports on Verified:
  - Qwen3.8-Max 86.1 (its launch table also lists GPT-5.6 Sol Max at 83.2 and Fable 5 at 85.0) — [Steel data](https://github.com/steel-dev/leaderboard); [VentureBeat](https://venturebeat.com/technology/qwen3-8-max-arrives-with-a-bold-claim-it-outperforms-gpt-5-6-sol-max-and-fable-5-on-agentic-computer-use) (snippet).
  - Claude Mythos Preview 85.4, Mythos 5 85.0, Fable 5 85.0, Opus 4.8 83.4, Sonnet 5 81.2, Sonnet 4.6 78.5. All use 361 tasks, 100 max steps, max effort and a multi-run average, on "Anthropic's revised harness (zoom-tool fix, 128K tokens/turn) — not directly comparable to older entries" — [Steel data](https://github.com/steel-dev/leaderboard), which quotes Anthropic system cards.
  - GPT-5.4: 75.0% against a human baseline of 72.4% — [OpenAI GPT-5.4](https://openai.com/index/introducing-gpt-5-4/) (snippet).
- Step budgets on Verified (official runs, same model):

  | Model | 15 steps | 50 steps | 100 steps |
  |---|---|---|---|
  | Claude Sonnet 4.5 | 42.88 | 58.08 | 62.88 |
  | Claude 4 Sonnet | 31.2 | 43.9 | 41.4 |
  | Claude 3.7 Sonnet | 27.1 | 35.8 | 35.6 |
  | o3 | 9.1 | 17.17 | 23.0 |
  | computer-use-preview | 26.0 | 31.3 | 31.4 |
  | Agent S2.5 w/ o3 | 39.0 | 54.2 | 56.0 |
  | CoACT-1 (150 steps: 60.76) | 39.81 | 56.39 | 59.93 |
  | Jedi-7B w/ o3 | 42.4 | 50.6 | 51.0 |
  | UiPath Screen Agent w/ Opus 4.5 | — | 64.4 | 67.14 |

  Source: [osworld_verified_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data).

**OSWorld 2.0 / 2.1 (2026)**
- The paper, code and release **osworld-v2-2026.06.24** came out on 2026-06-26. Release **osworld-v2-2026.08.08** followed on 2026-08-08 with updated code, task files, assets and mocked websites. **osworld-v2.1** followed on 2026-09-16 as a "bug-fix release with updated agents, evaluation workflows, and pinned task, asset, website, and provider image references".
- Hosting of the 2026.06.24 websites ended on 2026-09-08. All three releases have 108 tasks. The maintainers warn not to mix releases for comparable runs.
- The v2.1 manifest's own "limitations" include "No full 108-task agent evaluation", and task 029 retains a setup timeout.
- Sources: [OSWorld-V2 README](https://github.com/xlang-ai/OSWorld-V2); [benchmark_releases](https://github.com/xlang-ai/OSWorld-V2/tree/main/benchmark_releases).
- The repo ships `test_v2.json` (108 tasks) and `test_v2_offline_no_internet.json` (**82 tasks**). "Offline" is therefore the 82-task no-internet subset, not a separate benchmark — [OSWorld-V2 evaluation_examples](https://github.com/xlang-ai/OSWorld-V2/tree/main/evaluation_examples) (task counts read directly from the files).
- Tasks cover 31 self-hosted websites plus desktop apps. Humans take a median of about 1.6 hours per task. Tasks average 318 tool calls for Claude Opus 4.7 at max thinking, compared with about 30 in OSWorld 1.0 — [OSWorld 2.0 arXiv 2606.29537](https://arxiv.org/abs/2606.29537) (snippet); [GitHub](https://github.com/xlang-ai/OSWorld-V2).
- Scoring has two metrics: **binary/strict completion** (every checkpoint must pass) and **partial score** (a weighted average over checkpoints; 27.25 checkpoints per task on average) — [arXiv 2606.29537](https://arxiv.org/abs/2606.29537) (snippet). The code emits a `score` equal to the weighted sum of `partial_scores` — [EVALUATE_RESULT_JSON.md](https://github.com/xlang-ai/OSWorld-V2/blob/main/docs/EVALUATE_RESULT_JSON.md).
- Step budgets: the official guide's examples use `--max_steps 200` (GPT Responses API) and `--max_steps 500` (Claude) with screenshot observation — [PUBLIC_EVALUATION_GUIDELINE_v2.1.md](https://github.com/xlang-ai/OSWorld-V2/blob/main/docs/PUBLIC_EVALUATION_GUIDELINE_v2.1.md). Author runs, Anthropic runs and Snorkel runs all use 500 steps. For GPT-5.5, binary completion was "flat across 150/300/500 steps" — [Steel data](https://github.com/steel-dev/leaderboard).
- The paper's headline: at 500 steps, Claude Opus 4.8 with max thinking and batched tool calls completes 20.6% (binary) with a 54.8% partial score — [arXiv 2606.29537](https://arxiv.org/abs/2606.29537) (snippet).
- I found no human success-rate baseline for OSWorld 2.0; only the human time (median 1.6 h) is reported.

**How the target models are reported**
- Anthropic (Opus 5.5 launch, 2026-09-22), "OSWorld 2.1, partial":
  - Opus 5.5 81.8%, Fable 5.1 80.7%, Opus 5 74.0%.
  - GPT-6 Astra and GPT-5.6 Sol are shown as "—". Opus 5.5 results use "adaptive thinking at max effort" unless noted.
  - Source: [Anthropic, Introducing Claude Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5).
- Anthropic (Sonnet 5.5 launch, 2026-09-28), "OSWorld 2.1, partial":
  - Sonnet 5.5 80.1%, Sonnet 5 57.0%, Opus 5.5 81.8%; GPT-6 Sol "—".
  - Default effort is Medium in Claude apps and Claude Code, and High on the Claude Platform.
  - Source: [Anthropic, Introducing Claude Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5).
- Opus 5.5 system card: OSWorld 2.x strict 48.7% alongside 81.8% partial — [llm-stats](https://llm-stats.com/blog/research/claude-opus-5-5-launch) and [orcarouter](https://www.orcarouter.ai/blog/claude-opus-5-5-benchmark) (snippets; I could not open the [system card PDF](https://www-cdn.anthropic.com/fc1b44717c85dc068bc6ba5024219938094694bd/Claude%20Opus%205.5%20System%20Card.pdf)).
- OpenAI (GPT-6 Astra launch, 2026-09-03): Astra 72.6% compared with GPT-5.6 Sol 65.7%. The metric is a "partial score on the 2026.08.08 offline subset under a latency simulation", at about 40 min/task (Astra) versus about 75 min/task (5.6 Sol). The same table lists Opus 5 at 70.2% for a reproduced run on the offline subset — [Steel data](https://github.com/steel-dev/leaderboard) quoting [OpenAI](https://openai.com/index/gpt-6-astra/); [DataCamp](https://www.datacamp.com/blog/gpt-6-astra) (snippet).
- OpenAI (GPT-6 Sol and Luna launch, 2026-09-22), "OSWorld 2.0 offline":
  - GPT-6 Sol at xhigh scores 60.5%, versus Claude Opus 5 at medium 60.3%, at about 80% lower cost per task.
  - GPT-6 Luna (max) is reported at **52.7%** and "exceeds GPT-5.6 Sol (medium) at one-tenth the cost" — [emergent.sh](https://emergent.sh/learn/gpt-6-luna-benchmarks), [Vellum](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained) (snippets).
  - **Conflict:** other snippets give Luna (max) **66.6%**, "comparable to Claude Opus 5 and Fable 5 at medium effort". They also note that "OpenAI did not publish a standalone Luna percentage in the body text" — [search snippets for Vellum / OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/).
- OpenAI (GPT-6.1 Sol, announced 2026-09-29 at DevDay), OSWorld 2.0 offline, max effort: GPT-6.1 Sol 71.4% versus GPT-6 Sol 64.4% (+7.0 pp), at less than half the cost. It is "within 2.1 pp of Astra" at about one-seventh the cost per completed task — [OpenAI](https://openai.com/index/introducing-gpt-6-1-sol/), [Vellum](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained) (snippets).
- Other OSWorld 2.0 rows ([Steel data](https://github.com/steel-dev/leaderboard); notes quote each primary source):
  - Opus 5: 70.6 (Anthropic card; five-run first-attempt average, 1080p, 500 steps, Opus 4.8 grader).
  - Opus 5 (Snorkel independent run, max effort, batched tools, 500 steps): 68.31 partial / 31.43 binary.
  - GPT-5.6 Sol: 62.6 (OpenAI, GPT-5.6 launch); 62.72 partial / 27.34 binary in Snorkel's run.
  - Fable 5: 66.1 (Opus 5 card table).
  - Fable 5.1: 77.9 partial / 41.7 strict on the 2026.08.08 release. Its card says that run modified tasks and grading.
  - Muse Spark 1.3: 66.9 / 32.0.
  - Simular Sai: 73.0 / 28.25 (self-reported by a benchmark co-author).
  - Opus 4.8: 55.7 (Opus 5 card) vs 54.8 / 20.6 (authors, batched tools) vs 49.33 / 18.52 (authors, standard tools).
  - Opus 4.7: 49.1 / 13.9 (standard tools), 48.91 / 18.2 (batched).
  - GPT-5.5 xhigh, batched: 49.5 / 13.0.
  - Sonnet 4.6: 41.5 / 8.3 at max thinking, 33.9 / 9.3 at medium.
  - MiniMax M3 22.3 / 4.6; Kimi 2.6 22.1 / 4.6; Qwen 3.7-Plus 21.5 / 2.8; Qwen3.8-Flash-Next 52.3 / 19.4.
- Aggregators mislabel versions. For example, llm-stats lists Opus 5.5's 0.818 as the "OSWorld 2.0" leader, although Anthropic labels it OSWorld 2.1 — [llm-stats](https://llm-stats.com/benchmarks/osworld-2.0) (snippet).

### Inferences
- **Original → Verified (same model, same step budget; 11 pairs from the official sheets):**
  - Uplift: mean +5.3 pp, median +4.4 pp, SD 3.6 pp.
  - In logits: mean +0.27, median +0.22, SD 0.20.
  - The uplift is largest for Claude 3.7 Sonnet (+7.6 to +11.6 pp) and smallest for UI-TARS-72B-DPO (+1.2 pp).
  - Rule of thumb: a pre-July-2025 OSWorld score ≈ Verified − 4 to 5 pp. The model-to-model spread (±3.6 pp) is as large as the shift, so use it only for historical anchors.
- **Step budget (Verified):**
  - 15→50 steps: median +10.7 pp (median +0.58 logits, n=8).
  - 50→100 steps: median +2.7 pp (+0.12 logits, n=11). Several older models are flat or negative from 50 to 100.
  - Budgets have to match. A 15-step score understates a frontier model by 15–20 pp relative to 100 steps (e.g., Sonnet 4.5: 42.9 → 62.9).
  - On OSWorld 2.0, all frontier reports use 500 steps, or a wall-clock latency simulation in OpenAI's case. That is a different axis of budget control, and GPT-5.5 binary did not improve beyond 150 steps.
- **Verified vs 2.x (cross-benchmark, 8 models):**
  - Fit: logit(2.0 partial) = −3.47 + 2.44 × logit(Verified); r = 0.89; residual SD 0.46 logits.
  - Frontier models with Verified 83–85 span 55.7–70.6 on OSWorld 2.0. Sonnet 5 (Verified 81.2) scores 57.0 on 2.1, while Opus 5 (Verified 83.4) scores 74.0.
  - **Converting Verified into 2.x at the frontier is not reliable:** residuals reach ±9 pp, and Sonnet 4.6 is +17.5 pp. Verified is saturated and compresses differences that 2.x resolves.
- **2.0 → 2.1 (Anthropic, same vendor):**
  - Opus 5: 70.6 → 74.0 (+3.4 pp, +0.17 logits).
  - Fable 5.1: 77.9 (a modified 0808 run) → 80.7 (+2.8 pp).
  - Only two pairs exist. The shift mixes v2.1 bug fixes with run noise, so treat 2.1 ≈ 2.0 + about 3 pp with ±3 pp uncertainty.
- **OpenAI offline (0808, 82 tasks, latency-simulated) → Anthropic 2.1 partial, via the single Opus 5 anchor:**
  - Anchor pair: 70.2 (OpenAI offline) vs 74.0 (Anthropic 2.1). Offset +3.8 pp; logit shift +0.189.

  | Model (OpenAI offline score) | Additive estimate on 2.1 scale | Logit estimate on 2.1 scale |
  |---|---|---|
  | GPT-6 Astra 72.6 | ≈ 76.4 | ≈ 76.2 |
  | GPT-6.1 Sol 71.4 | ≈ 75.2 | ≈ 75.1 |
  | GPT-6 Sol max 64.4 | ≈ 68.2 | ≈ 68.6 |
  | GPT-6 Sol xhigh 60.5 | ≈ 64.3 | ≈ 64.9 |
  | GPT-6 Luna max 52.7 | ≈ 56.5 | ≈ 57.4 |

  - If Luna is really 66.6 (the conflicting figure), it maps to about 70.5.
  - On the 2.1 scale the ordering is Opus 5.5 81.8 > Sonnet 5.5 80.1 > Astra ≈ 76 > 6.1 Sol ≈ 75 > Luna ≈ 57.
  - Estimated 1σ uncertainty on a bridged value is about ±4–5 pp. This is my estimate, not a reported figure. It assumes a per-task partial-score SD of about 0.28, giving SE ≈ 2.7 pp (108 tasks) or 3.1 pp (82 tasks) per run, combined across anchor and target runs.
  - Differences of 5 pp or less between Anthropic-reported and bridged OpenAI numbers should not be read as meaningful.
- **Partial → strict (17 rows, mixed releases):**
  - Fit: logit(strict) = −1.696 + 1.131 × logit(partial); r = 0.978; residual SD 0.21 logits.

  | Partial score | Estimated strict | Approx. 68% band |
  |---|---|---|
  | 81.8 (Opus 5.5) | 50.1 (reported 48.7) | — |
  | 80.1 (Sonnet 5.5) | ≈ 47 | 42–52 |
  | 72.6 (Astra, offline scale) | ≈ 36 | 31–41 |
  | 71.4 (GPT-6.1 Sol) | ≈ 34 | — |
  | 64.4 (GPT-6 Sol max) | ≈ 26 | — |
  | 52.7 (Luna) | ≈ 17 | — |

  - Strict scores discriminate more but are noisier. The binomial SE at n = 108 and p ≈ 0.49 is ±4.8 pp.
- **An open OpenAI discrepancy:** 71.4 + 2.1 = 73.5, which implies the GPT-6.1 Sol post lists Astra at about 73.5 rather than the 72.6 in Astra's launch post. It may be a re-run or a different release. This is unverified.

### Gaps
- I could not read the OSWorld 2.0 paper body, Epoch's OSWorld 2 page, Snorkel's leaderboard, or the Opus 5.5 / Sonnet 5.5 system cards (all blocked). Missing as a result:
  - Whether Anthropic's 2.1 numbers use all 108 tasks or the offline subset. Anthropic's 2.0 figure for Opus 5 appears to be the full set.
  - The grader model used for 2.1.
  - Sonnet 5.5's effort setting and strict score.
- There is no official OSWorld 2.x human success baseline, and there is no independent OSWorld 2.1 run of any target model.
- There is no OpenAI number on OSWorld 2.1 and no Anthropic number on the 0808 offline subset for Opus 5.5 or Sonnet 5.5. The bridge rests on one model (Opus 5).
- The GPT-6 Luna figure conflicts (52.7 vs 66.6). 52.7 is internally consistent with "exceeds GPT-5.6 Sol medium" and sits below GPT-5.6 Sol's 62.6 max, but it is not confirmed from OpenAI's page.
- I found no OSWorld-Verified numbers for GPT-6 Astra, GPT-6 Sol, GPT-6.1 Sol, Luna, Opus 5.5 or Sonnet 5.5. Vendors appear to have stopped reporting Verified.

---

## 2. Browser benchmarks: variants, changes, saturation, and which still discriminate

### Takeaway
- **BrowseComp** (1,266 questions, live web) is saturated: the top systems sit at 90–92% and the top five are within 1.8 pp. Scores depend heavily on harness choices such as multi-agent setups, context management and compaction.
- **BrowseComp-Plus** (830 queries, fixed corpus of about 100K documents) isolates the retriever, and frontier-lab launch posts rarely use it.
- **WebVoyager** (up to 99%) and self-reported **Online-Mind2Web** (97%) are saturated and depend on the judge.
- The original **WebArena** is not used by frontier labs any more. **WebArena-Verified** (812 tasks plus a 258-task Hard subset, deterministic scoring) has no frontier-model numbers I could find.
- Still discriminative in 2026: OSWorld 2.x (strict especially), **BU Bench V2.1** (200 tasks, rubric-scored; the legacy 60-task results are not comparable), **ClawBench** (top score 33%), **HealthAdminBench** (top 52%) and **DRACO** (top 88.6%).
- None of the five target models has a BrowseComp number I could verify, except as comparators via predecessors.

### Cited Findings

**BrowseComp (OpenAI, 2025-04)**
- 1,266 problems. Human trainers, with a two-hour limit per problem, solved 29.2%, and 86.4% of their answers matched the reference — [OpenAI BrowseComp](https://openai.com/index/browsecomp/); [paper PDF](https://cdn.openai.com/pdf/5e10f4ab-d6f7-442e-9508-59515c65e35d/browsecomp.pdf) (snippet).
- From the same source (training knowledge; the page was blocked for re-verification): GPT-4o scored 0.6% without browsing and 1.9% with browsing; o1 9.9%; Deep Research 51.5%. The with/without-tool split only mattered for early models. Every 2026 frontier report uses tools: search, fetch, code and often compaction.
- Top 2026 entries ([Steel data](https://github.com/steel-dev/leaderboard), notes quote vendor sources):
  - GPT-5.6 Sol Ultra (4 parallel agents): 92.2.
  - GPT-6 Astra (single agent, max at any effort): 91.5.
  - Kimi K3: 91.2 with compaction at 300K; 90.4 with the full 1M context and no management.
  - Claude Opus 5 (single agent, max effort, compaction at 200k, Opus 4.7 grader): 90.8. OpenAI's Astra table lists the same 90.8.
  - GPT-5.6 Sol: 90.4.
  - Mythos 5: 88.0 single agent, 93.3 async multi-agent.
  - Fable 5: 88.0 (third-party run by Thinking Machines).
  - Sonnet 5: 84.7 single, 86.6 multi-agent.
  - Opus 4.8: 84.3 single, 88.5 multi-agent.
- Context-management effects on BrowseComp ([Steel data](https://github.com/steel-dev/leaderboard)):
  - GLM-4.7: 52.0 standard, 67.5 context-managed.
  - Qwen3.5-397B: 69.0 with context-folding, 78.6 with discard-all.
  - LongCat-Flash-Thinking: 56.6 standard, 73.1 in "heavy thinking" mode.
  - Kimi K2.5: 74.9 single agent, 78.4 with Agent Swarm.
- BrowseComp is "nearing saturation … top models clustering within 1.0 points". One aggregator lists an "Atria Dawn Preview" at 92.5% — [BenchLM](https://benchlm.ai/benchmarks/browsecomp) (snippet; unverified entry).

**BrowseComp-Plus (ACL 2026)**
- It takes BrowseComp queries but searches a fixed, curated corpus of about 100K human-verified documents, so retriever and agent can be compared separately. The LLM judge is Qwen3-32B — [texttron/BrowseComp-Plus](https://github.com/texttron/BrowseComp-Plus).
- 830 queries over 100,195 documents. GPT-5 scores 55.9% with BM25 and 70.1% with Qwen3-Embedding-8B — [arXiv 2508.06600](https://arxiv.org/abs/2508.06600) (snippet).
- The current #1 is Reason-ModernColBERT at 87.59% — [LightOn](https://lighton.ai/lighton-blogs/the-bloated-retriever-era-is-over) (snippet).

**WebArena, WebArena-Verified, VisualWebArena**
- The original WebArena has 812 tasks. Its annotations were fixed in v0.2.0 (2023-10). Maintainers recommend running it through AgentLab/BrowserGym, which also integrates VisualWebArena — [web-arena-x/webarena](https://github.com/web-arena-x/webarena).
- The top systems on the original WebArena are agent frameworks, not bare models: WebTactix (DeepSeek v3.2) 74.3%, OpAgent 71.6%, ColorBrowserAgent 71.2%, Claude Code + GBOX MCP 68.0%. For comparison, OpenAI Operator scored 58.1% and Kimi K2.5 58.9% — [Steel data](https://github.com/steel-dev/leaderboard).
- WebArena-Verified (ServiceNow; public release December 2025; on PyPI since 2026-01):
  - Every task, reference answer and evaluator was audited.
  - The LLM judge and substring matching were replaced with type-aware deterministic comparators.
  - It supports offline evaluation from network-trace replay.
  - It has 812 tasks and a 258-task "Hard" subset.
  - Source: [ServiceNow/webarena-verified](https://github.com/ServiceNow/webarena-verified).
- A 2026 audit of 150 failure-scored trajectories from five benchmarks found that 15.3% of FAIL verdicts are wrong: 10.7% are evaluator false negatives and 4.7% are broken tasks. The examples include WebArena string-match rejections and OSWorld alternative solutions that state checkers missed — [arXiv 2607.28367](https://arxiv.org/abs/2607.28367) (snippet).

**Online-Mind2Web (OSU, COLM 2025)**
- 300 tasks on 136 live websites. Tasks are replaced periodically: 36 on 2025-11-03, 6 on 2026-05-15, among others. The maintainers plan to "revise simple tasks" once performance saturates. The v2 submission schema and outsourced human evaluation (via Careerflow) arrived on 2026-05-23 — [OSU-NLP-Group/Online-Mind2Web](https://github.com/OSU-NLP-Group/Online-Mind2Web).
- WebJudge (o4-mini) agrees with humans 86% of the time, with a 3.8-pp gap in success rate — [README](https://github.com/OSU-NLP-Group/Online-Mind2Web). Human evaluation is the primary metric — [Careerflow](https://www.careerflow.ai/human-data/blogs/online-mind2web-human-evaluation-partner) (snippet).
- Human vs WebJudge for the same agent ([Steel data](https://github.com/steel-dev/leaderboard)):
  - Yutori Navigator: 78.7 vs 64.7.
  - Gemini 2.5 CU: 69.0 vs 57.3.
  - Claude 4.0: 61.0 vs 47.7.
  - Claude 4.5: 55.0 vs 59.3.
  - Operator: 61.3 vs 71.8.
- Self-reported leaders ([Steel data](https://github.com/steel-dev/leaderboard)):
  - Browser Use Cloud bu-max: 97.0, using a custom agentic judge built on the Claude Agent SDK; not comparable.
  - GPT-5.4 native computer use: 93.0 (raw data not public).
  - ABP + Opus 4.6: 90.53 (all 300 results public).
- On HAL's independent harness the top result is SeeAct + GPT-5 Medium at 42.3%. Browser-Use + Sonnet 4 scores 40% at a cost of $1,577, versus $171 for SeeAct + GPT-5 Medium. Claude models do better in Browser-Use, OpenAI models in SeeAct — [HAL, arXiv 2510.11977](https://arxiv.org/abs/2510.11977) (snippet).

**WebVoyager**
- Top self-reported results ([Steel data](https://github.com/steel-dev/leaderboard)):
  - browser-control (Fable 5): 99.19%. That is 610/615 after four "current-impossible" exclusions, judged by GPT-5.5.
  - Alumnium: 98.5.
  - Surfer 2: 97.1.
  - browser-control (Opus 4.8): 90.41, with 47 prompt edits.
- Notte: 86.2 on its own harness vs 79.0 under LLM evaluation — [Steel data](https://github.com/steel-dev/leaderboard).

**2026 browser benchmarks**
- **BU Bench V2.1 (Browser Use)** — [browser-use/benchmark](https://github.com/browser-use/benchmark):
  - 200 web tasks scored against weighted "findings" rubrics, with partial credit. Default limits: 60 min per task and up to 100 concurrent tasks.
  - Reference executor: BrowserCode 0.1.20 with `gpt-6-luna` at xhigh. Judge: `gpt-5.6-luna` at xhigh.
  - Latest release v2.1.1, with a CAPTCHA/Walmart alignment update and a task-185 redesign on 2026-09-25. Historical task-185 scores are not comparable.
  - The legacy 60-task V2 chart, which includes GPT-6 Astra, is "not results for the current 200-task V2.1 dataset".
  - The judge now excludes agent `thinking`/`reasoning` summaries.
- **Halluminate Westworld**: web-agent tasks on simulated realistic sites (dataset on Hugging Face, API key required). I found no public scores — [Halluminate/westworld](https://github.com/Halluminate/westworld).
- **ClawBench** (live-web transactions, 2026-04): Sonnet 4.6 33.3, GLM-5 24.2, Gemini 3 Flash 19.0, GPT-5.4 6.5 — [Steel data](https://github.com/steel-dev/leaderboard) / [arXiv 2604.08523](https://arxiv.org/abs/2604.08523).
- **HealthAdminBench** (2026-04; [arXiv 2604.09937](https://arxiv.org/abs/2604.09937) via [Steel data](https://github.com/steel-dev/leaderboard)):
  - Anthropic internal ports with a browser-use scaffold: Mythos 5 51.9, Opus 4.8 51.9.
  - Paper harness: Opus 4.6 native CUA 36.3 vs 14.8 in the standardized screenshot-only harness vs 51.9 with a11y-tree input. GPT-5.4 native CUA 26.7 vs 5.9 in the standardized harness.
- **DRACO**: Opus 5 88.6, Mythos 5 86.4 — [Steel data](https://github.com/steel-dev/leaderboard).
- Steel also tracks Online-Mind2Web, WebArena, WebVoyager, BrowseComp, OSWorld and OSWorld 2.0 — [steel-dev/leaderboard](https://github.com/steel-dev/leaderboard).

### Inferences
- **Saturated at the frontier:**
  - BrowseComp: about 90–92 and above the human-trainer 29%. It is judged by an LLM grader, and harness changes (multi-agent +1.8 to +5.3 pp; context management up to +15 pp) exceed the gaps between models.
  - WebVoyager: 97–99.
  - Self-reported Online-Mind2Web: 90–97.
  - OSWorld-Verified: 83–90, above the human 72.
- **Still discriminative:** OSWorld 2.x (partial 50–82, strict 13–49), BU Bench V2.1, ClawBench, HealthAdminBench, DRACO, and arguably WebArena-Verified Hard, though frontier data are lacking there.
- **Online-Mind2Web human vs WebJudge:** the gap is not systematic. Human minus auto ranges from −10.5 to +14.0 pp (mean +4.8, SD about 11.4, n=5). No conversion is defensible; only compare scores that used the same judge.
- **BrowseComp:** the one clean cross-vendor check agrees. Anthropic's 90.8 for Opus 5 is reproduced in OpenAI's own table. Differences below about 1 pp are within the binomial SE (±0.8 pp at 90%, n = 1,266).
- **For a Pareto chart of the five target models:** use OSWorld 2.x as the primary computer-use axis. Use BU Bench V2.1 as the browser axis if runs exist, noting that the project's own harness uses GPT-6 Luna, so harness bias should be checked. BrowseComp should be at most a low-weight, near-ceiling signal.

### Gaps
- I found no published BrowseComp scores for Opus 5.5, Sonnet 5.5, GPT-6.1 Sol, GPT-6 Sol or GPT-6 Luna. Astra has 91.5.
- There are no WebArena-Verified numbers for any 2026 frontier model, and no conversion from WebArena to WebArena-Verified. I found no paired data in either the ServiceNow README or search.
- I found no 2026 VisualWebArena frontier numbers.
- There are no Westworld scores, and no Steel-authored benchmark beyond its curated leaderboard.
- I could not open the BU Bench V2.1 leaderboard values (the repo shows plots only).
- The Online-Mind2Web human leaderboard CSV is on Hugging Face, which is blocked.

---

## 3. Max/high effort vs default effort, and vendor harness vs independent harness

### Takeaway
- Vendors headline **max effort** ("maximum at any effort"; "adaptive thinking at max effort"). Default effort is lower: Anthropic uses Medium in its apps and High on the API.
- On OSWorld 2.0, going from medium/default to max adds about **+4 to +10 pp partial**, with little or no gain in strict.
- **Vendor-reported vs independent** runs on the *same* harness settings agree within about 0–2.3 pp: Opus 5 70.6 vs Snorkel 68.3; GPT-5.6 Sol 62.6 vs Snorkel 62.7.
- **Harness changes** move scores 5–20+ pp: batched tools, Anthropic's revised OSWorld-Verified harness, native CUA vs a generic harness, a11y-tree input, multi-agent setups, and context management. Harness identity has to be tracked as a variable.

### Cited Findings
- **Effort (OSWorld 2.0 partial):**
  - Claude Opus 5 medium 60.3% (OpenAI offline-subset table) vs 70.2% in OpenAI's reproduced run on the same subset, and 70.6% at Anthropic's max-effort, 500-step setting — [Vellum / OpenAI](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained) (snippet); [Steel data](https://github.com/steel-dev/leaderboard). I infer the 70.2 run is max effort; it is not stated.
  - GPT-6 Sol: xhigh 60.5 vs max 64.4 — [Vellum](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained), [OpenAI GPT-6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/) (snippets).
  - Sonnet 4.6: medium 33.9 / 9.3 binary vs max 41.5 / 8.3 binary. Binary is lower at max — [Steel data](https://github.com/steel-dev/leaderboard).
  - GPT-5.6 Sol: max 62.6 (OpenAI). Medium is below Luna-max's 52.7, since OpenAI says Luna max "exceeds" it — [Steel](https://github.com/steel-dev/leaderboard); [emergent.sh](https://emergent.sh/learn/gpt-6-luna-benchmarks) (snippet).
- **Effort on non-CU benchmarks, for scale:** Opus 5.5 on CursorBench scores 52.5% at default (medium) and 57.8% at max (+5.3 pp) — [Anthropic Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5). Sonnet 5.5 scored lower at Max than at Xhigh on FrontierCode because of timeouts and out-of-scope edits — [Anthropic Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5).
- **Anthropic's defaults:** "In Claude Code and our apps, the default effort is set to Medium, while the Claude Platform defaults to High." Anthropic plots every effort level as a cost-vs-score point — [Anthropic Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5).
- **Vendor vs independent, same benchmark:**
  - OSWorld 2.0, Opus 5: 70.6 (Anthropic) vs 68.31 (Snorkel, max effort, batched tools) vs 70.2 (OpenAI table, offline subset).
  - OSWorld 2.0, GPT-5.6 Sol: 62.6 (OpenAI) vs 62.72 (Snorkel). OpenAI's later offline + latency-simulation figure is 65.7.
  - OSWorld 2.0, Opus 4.8: 55.7 (Anthropic) vs 54.8 (authors, batched) vs 49.33 (authors, standard tool calls).
  - Source for all three: [Steel data](https://github.com/steel-dev/leaderboard).
- **OSWorld-Verified, vendor vs official xlang runs:**
  - Sonnet 4.5: 61.4 vendor vs 62.88 official.
  - Fable 5: 85.0 vs 85.96.
  - Sonnet 4.6: 78.5 on Anthropic's revised harness vs 72.11 official.
  - Mythos Preview: 79.6 (Glasswing) vs 85.4 (Anthropic's revised harness).
  - Sources: [Steel data](https://github.com/steel-dev/leaderboard); [osworld_verified_results.xlsx](https://github.com/os-world/os-world.github.io/tree/main/static/data).
- **Tool batching (OSWorld 2.0 authors' runs):**
  - Opus 4.8: standard 49.33 / 18.52 → batched 54.8 / 20.6.
  - Opus 4.7: standard 49.1 / 13.9 → batched 48.91 / 18.2.
  - Source: [Steel data](https://github.com/steel-dev/leaderboard).
- **Native vs generic harness (HealthAdminBench):** Opus 4.6 36.3 native vs 14.8 in the generic harness; GPT-5.4 26.7 vs 5.9 — [arXiv 2604.09937](https://arxiv.org/abs/2604.09937) via [Steel](https://github.com/steel-dev/leaderboard).
- **Literature on harness effects:**
  - Keeping the model fixed while changing only the harness raised Terminal-Bench 2 from 69.7% to 77.0%. Third-party monitoring reports up to 15 pp of scaffold-only variation on SWE-bench Verified — [arXiv 2605.23950](https://arxiv.org/abs/2605.23950) (snippet).
  - HAL reports double-digit scaffold gaps for the same model — [HAL arXiv 2510.11977](https://arxiv.org/abs/2510.11977) (snippet).
- **Epoch's ECI takes the max over settings.** Its loader aggregates "(model group, benchmark) taking max performance" — [eci-public dataloader](https://github.com/epoch-research/eci-public).

### Inferences
- When the harness is held fixed, vendor self-reports on OSWorld 2.0 are **not systematically inflated**. The mean vendor-minus-independent gap is about +0.9 pp over 4 like-for-like comparisons: +2.3, +0.4, −0.1 and +0.9. Correcting vendor numbers by more than about 2 pp is not justified.
- **Harness revisions are the dominant source of bias.** Anthropic's revised Verified harness adds about +6 pp (Sonnet 4.6 and Mythos Preview). Batched tools add up to +5.5 pp partial and +4 pp strict.
- On a Pareto chart, plot **each effort level as its own point**, because vendors publish cost per effort. If one point per model is needed, use max-effort (matching ECI) and state it. Default-effort points sit roughly 4–10 pp lower on OSWorld 2.x partial.
- Max effort can **lower** strict completion (Sonnet 4.6), so effort effects differ by metric.

### Gaps
- I found no per-effort OSWorld 2.1 curve for Opus 5.5 or Sonnet 5.5. The Anthropic pages show cost-vs-score charts for coding and knowledge work, and not for OSWorld.
- There is no independent run of Astra, GPT-6.1 Sol or Luna on any OSWorld 2.x release.
- I could not access Artificial Analysis's methodology pages (blocked). Their harness vs vendor gaps for computer use are unknown.

---

## 4. Methods for combining heterogeneous benchmark results into one index

### Takeaway
The most defensible method with sparse data has three steps:
1. **Normalize** each score for chance and ceiling, then work in **log-odds (logit) space**.
2. **Harmonize within a benchmark family** to one canonical variant using anchor models, with an explicit residual uncertainty.
3. **Fit or reuse an IRT/ECI-style model** across families: performance = σ(α_b·(C_m − D_b)), with bootstrap confidence intervals.

Z-scores and raw-pp linear maps break near ceilings and depend on the sample. Error-rate ratios are the near-ceiling special case of logit differences. Show uncertainty from benchmark sampling, run/harness variance, and conversion residuals.

### Cited Findings
- **ECI model:** performance(m,b) = σ(α_b[C_m − D_b]), with α_b the benchmark's slope ("steeper" means it saturates quickly). Parameters are fit by non-linear least squares with a ridge penalty — [LessWrong, Introducing ECI](https://www.lesswrong.com/posts/2RtuThoZwP4o8aEpS/introducing-the-epoch-capabilities-index-eci); [ECI methodology](https://epoch.ai/data/eci-documentation/methodology) (snippet).
- **Scale:** Claude 3.5 Sonnet is fixed at 130 and GPT-5 at 150. The fit covers about 40 benchmarks and about 200 models, with R² ≈ 0.86–0.87 — [Epoch "Rosetta Stone"](https://epoch.ai/publications/a-rosetta-stone-for-ai-benchmarks); [arXiv 2512.00193](https://arxiv.org/abs/2512.00193) (snippets).
- **Implementation details** from [eci-public](https://github.com/epoch-research/eci-public):
  - Scores are normalized as (raw − random_baseline)/(ceiling − random_baseline) and clipped to [0.001, 0.999].
  - L2 regularization strength is 0.1. The anchor benchmark is Winogrande, with discriminability 1.0.
  - Uncertainty comes from 500 bootstrap refits that resample each model's benchmark results.
  - Models need at least 4 benchmarks.
  - Benchmark supersession uses `superseded_by`, for example "FrontierMath v2 replaces v1 tier-for-tier where a group has both".
  - The max is taken across settings.
- **HAL** adds cost and scaffold as explicit dimensions, and shows that the Pareto frontier depends on scaffold–model pairing — [HAL](https://arxiv.org/abs/2510.11977) (snippet).
- **Harness disclosure:** comparisons of long-horizon agents are "incomplete and potentially misleading" unless the harness is disclosed. The paper proposes a variance decomposition across model and harness — [arXiv 2605.23950](https://arxiv.org/abs/2605.23950) (snippet).

### Inferences
- **Why logits.** Near the ceiling, a +2 pp gain at 90% is about the same logit change as roughly +5 pp at 50%. That matches the observed compression: Verified at 83–85 corresponds to 2.0 at 56–71.
  - The within-family conversions above work better in logit space. Original → Verified has a lower relative SD in logits (0.20 around 0.27) than in pp.
  - "Error-rate ratio" (e.g., 10% → 8% error equals a 1.25× reduction) is about the logit difference when p > 0.85. It is fine for BrowseComp and WebVoyager but wrong in the mid-range.
- **Anchor-model mapping:**
  - With one anchor (as for OpenAI offline → Anthropic 2.1 via Opus 5), use a logit shift and carry about ±4–5 pp of uncertainty.
  - With two or more anchors spanning the range, fit logit(B) = a + b·logit(A) and report the residual SD. The Verified → 2.0 fit has residual SD 0.46 logits, which is too loose at the frontier. The partial → strict fit has 0.21 logits, which is usable.
- **Z-scores** depend on which models are in the sample (5 targets is too few). They also ignore ceilings and difficulty. Avoid them.
- **IRT/ECI** is the only method that handles benchmarks of different difficulty and slope and missing entries in a principled way. With 5 target models and 2–3 CU/browser benchmarks each, a fresh fit is under-determined.
  - Mitigation: pin D_b and α_b using the many historical models in the xlang Verified sheet (about 150 rows), the Steel JSON (OSWorld 2.0 has 22 entries, BrowseComp 100, Online-Mind2Web 23, WebArena 50), and ECI values if Epoch publishes EDI and slope for OSWorld 2 / BrowseComp.
  - Then estimate each target's C_m by conditional maximum likelihood, with bootstrap CIs.
  - Treat each (benchmark, variant, harness) as its own "benchmark" in the fit, or harmonize variants first as in step 2. This matches ECI's supersession logic.
- **Recommended uncertainty display:**
  - (a) Sampling SE. Binomial SE is √(p(1−p)/n): ±4.8 pp for OSWorld 2.x strict at n = 108, p ≈ 0.49; ±5.3 pp at n = 82, p ≈ 0.35; ±1.9 pp for Verified at n = 361, p = 0.85; ±0.8 pp for BrowseComp at n = 1,266, p = 0.90; ±1.7 pp for Online-Mind2Web at n = 300, p = 0.90. For partial scores, estimated ±2.5–3 pp.
  - (b) Run/harness variance. For example, Opus 5 has three OSWorld 2.0 values (68.3, 70.2, 70.6; SD about 1.2 pp) and harness swings of 5–6 pp.
  - (c) Conversion residuals: 0.21 logits partial→strict; 0.46 logits Verified→2.0; single-anchor offsets about ±4–5 pp.
  - Use hollow or bracketed markers for converted points. Do not rank models whose CIs overlap.

### Gaps
- I could not download Epoch's `benchmark_data.zip` (epoch.ai is blocked). As a result, I have no Epoch EDI/slope parameters for OSWorld 2.0, OSWorld-Verified or BrowseComp, and no current ECI values for the five target models.
- The per-task score distributions for OSWorld 2.x partial scores are not public, so the partial-score SEs above are my assumptions.

---

## 5. Prior-generation anchors for chaining, and summary tables

### Takeaway
- The best chaining anchors are **Claude Opus 5** (OSWorld-Verified official 83.39; OSWorld 2.0 at 70.6 Anthropic / 68.31 Snorkel / 70.2 OpenAI-offline / 60.3 at medium; OSWorld 2.1 at 74.0; BrowseComp 90.8 from both vendors) and **GPT-5.6 Sol** (Verified 83.2; OSWorld 2.0 at 62.6 OpenAI / 62.72 Snorkel / 65.7 offline).
- **Claude Opus 4.8**, **Sonnet 4.6**, **Sonnet 4.5** and **Fable 5** add older links.
- Sonnet 5 (Verified 81.2 vs 2.1 57.0) shows that Verified cannot rank the current frontier.

### Cited Findings
- Anchor data are listed in Table 2 below. Sources: [os-world.github.io data](https://github.com/os-world/os-world.github.io/tree/main/static/data), [Steel data](https://github.com/steel-dev/leaderboard), [Anthropic Opus 5.5](https://www.anthropic.com/news/claude-opus-5-5), [Anthropic Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5), and the OpenAI launch posts cited above.
- GPT-5.4 (Verified 75.0, BrowseComp 82.7, Online-Mind2Web 93.0) is the last OpenAI model with a Verified self-report I found — [OpenAI GPT-5.4](https://openai.com/index/introducing-gpt-5-4/) (snippet); [Steel data](https://github.com/steel-dev/leaderboard).
- GPT-5.2 scored 47.3% on Verified — [DataCamp / OpenAI](https://www.datacamp.com/blog/gpt-5-4) (snippet).

### Inferences
- **Chain for OpenAI → Anthropic OSWorld scales:** OpenAI offline (0808) —[Opus 5: 70.2 ↔ 70.6]→ Anthropic 2.0 full —[Opus 5: 70.6 ↔ 74.0]→ Anthropic 2.1. The shifts are −0.4 pp and +3.4 pp, for a net +3.8 pp (+0.19 logits).
- **Cross-check with GPT-5.6 Sol:** its OpenAI offline + latency-simulation 65.7 vs launch 62.6 (+3.1 pp). The latency-simulated offline protocol may itself read about 3 pp higher than OpenAI's July protocol. This is an inference from one pair.
- **Chain for historical context:** original OSWorld ≈ Verified − 4 to 5 pp (11 pairs). The link from Verified to 2.x is too loose at the frontier (residual about ±9 pp), so do not chain pre-2026 models into the OSWorld 2.x scale except as rough context.

### Gaps
- No model has results on all four OSWorld variants, and none of the five target models has an independent OSWorld 2.x run.
- Opus 5 is the only model reported by both vendors on OSWorld 2.x. If its runs are noisy, every bridged OpenAI number shifts by the same amount.

### Table 1 — Benchmark variants in use (as of Sep 2026)

| Family | Variant | Year | Key differences | Saturated? | Frontier score range (2026) |
|---|---|---|---|---|---|
| OSWorld | Original OSWorld | 2024 | 369 tasks; VMware/Docker; 15/50/100-step budgets; screenshot / a11y / SoM modes; human 72.36% | Yes (superseded) | Not used for 2026 models; last Anthropic self-report was about 28 (3.7 Sonnet, 100 steps) |
| OSWorld | OSWorld-Verified | Jul 2025 | More than 300 task/evaluator fixes; AWS, 50× parallelism; 361 scored tasks (Google-Drive excluded); 100 steps standard; screenshot-only frontier runs; Anthropic uses a "revised harness" (+about 6 pp) | Yes (above human 72.4) | 72–86 for general models (official); 90.19 for the top framework |
| OSWorld | OSWorld 2.0 (2026.06.24, 2026.08.08) | Jun–Aug 2026 | 108 long-horizon tasks (median 1.6 human-hours), 31 mocked websites plus apps; partial (27.25 checkpoints/task) and strict metrics; 500-step budget common; LLM grader used in vendor runs | No | Partial 21–78; strict 3–42 |
| OSWorld | OSWorld 2.0 offline subset (0808) | Aug 2026 | 82 no-internet tasks; OpenAI adds a latency simulation (about 40–75 min/task) | No | 52.7 (Luna) – 72.6 (Astra) partial |
| OSWorld | OSWorld 2.1 | Sep 16, 2026 | Bug-fix release; pinned tasks, assets, sites and images; self-hosted websites; manifest notes no full 108-task verification run | No | 57.0 (Sonnet 5) – 81.8 (Opus 5.5) partial; Opus 5.5 strict 48.7 |
| BrowseComp | BrowseComp | 2025 | 1,266 live-web questions; LLM-graded; humans 29.2%; harness choices (multi-agent, compaction) swing 2–15 pp | Yes | About 84–92 |
| BrowseComp | BrowseComp-Plus | 2025 (ACL 2026) | 830 queries, fixed 100K-document corpus; retriever isolated; Qwen3-32B judge | Partly (retriever-dependent) | GPT-5: 55.9 (BM25) – 70.1; best system 87.6 |
| WebArena | WebArena (v0.2.0) | 2023 | 812 tasks, self-hosted sites; string-match evaluators (about 21.7% false-negative rate per audit) | Not used by labs; systems at 60–74 | Top systems 66–74 (frameworks) |
| WebArena | WebArena-Verified (+ Hard 258) | Dec 2025 | All tasks audited; deterministic type-aware scoring; offline trace replay | Unknown | No frontier numbers found |
| WebArena | VisualWebArena | 2024 | Visual tasks; available via BrowserGym | Unknown | No 2026 frontier numbers found |
| Mind2Web | Online-Mind2Web | 2025 (updates through May 2026) | 300 live tasks, 136 sites; human eval primary; WebJudge about 85% agreement; tasks replaced over time | Near-saturated for self-reports | Self-reported 90–97; HAL independent top 42.3 |
| WebVoyager | WebVoyager | 2024 | 643 tasks; self-graded, with judges and exclusions varying | Yes | 90–99 |
| Browser Use | BU Bench V2.1 (v2.1.1) | Sep 2026 | 200 tasks; weighted rubrics with partial credit; GPT-5.6-Luna judge; legacy 60-task V2 not comparable | No (presumed) | Not retrievable |
| Other 2026 | ClawBench / HealthAdminBench / DRACO / Westworld | 2026 | Live-web transactions / health-admin portals (a11y-sensitive) / deep research / simulated sites | No / No / Nearly / Unknown | 33.3 top / 51.9 top / 88.6 top / n/a |

### Table 2 — Paired scores usable for conversion

| Model | Variant A score | Variant B score | Source |
|---|---|---|---|
| **OSWorld original → Verified (same steps)** | | | |
| Claude 3.7 Sonnet (15 / 50 / 100 steps) | Original: about 15.5 / 26 / 28 | Verified: 27.1 / 35.8 / 35.6 | [os-world data](https://github.com/os-world/os-world.github.io/tree/main/static/data) |
| UI-TARS-72B-DPO (15 / 50) | 22.7 / 24.6 | 24.0 / 25.8 | same |
| Jedi-7B w/ GPT-4o (15 / 50 / 100) | 22.74 / 25.02 / 27.04 | 26.8 / 27.0 / 29.3 | same |
| GTA1 w/ o3 (100) | 45.2 | 53.1 | same |
| Agent S2 w/ Gemini 2.5 Pro (50) | 41.4 | 45.76 | same |
| OpenAI CUA (15) | 19.7 | 26.0 | same |
| **OSWorld-Verified step budgets** | | | |
| Claude Sonnet 4.5 (15 → 50 → 100) | 42.88 → 58.08 | → 62.88 | same |
| o3 (15 → 50 → 100) | 9.1 → 17.17 | → 23.0 | same |
| Agent S2.5 w/ o3 (15 → 50 → 100) | 39.0 → 54.2 | → 56.0 | same |
| CoACT-1 (15 → 50 → 100 → 150) | 39.81 → 56.39 | → 59.93 → 60.76 | same |
| UiPath Screen Agent w/ Opus 4.5 (50 → 100) | 64.4 | 67.14 | same |
| **OSWorld-Verified vs OSWorld 2.x partial** | | | |
| Claude Opus 5 | Verified 83.39 (official) | 2.0: 70.6 (Anthropic); 2.1: 74.0 | [os-world data](https://github.com/os-world/os-world.github.io/tree/main/static/data); [Steel](https://github.com/steel-dev/leaderboard); [Anthropic](https://www.anthropic.com/news/claude-opus-5-5) |
| Claude Sonnet 5 | Verified 81.2 (Anthropic) | 2.1: 57.0 | [Steel](https://github.com/steel-dev/leaderboard); [Anthropic Sonnet 5.5](https://www.anthropic.com/news/claude-sonnet-5-5) |
| Claude Fable 5 | Verified 85.0 (Anthropic) / 85.96 (official) | 2.0: 66.1 | [Steel](https://github.com/steel-dev/leaderboard); [os-world data](https://github.com/os-world/os-world.github.io/tree/main/static/data) |
| GPT-5.6 Sol | Verified 83.2 (Qwen3.8 launch table) | 2.0: 62.6 (OpenAI) | [VentureBeat](https://venturebeat.com/technology/qwen3-8-max-arrives-with-a-bold-claim-it-outperforms-gpt-5-6-sol-max-and-fable-5-on-agentic-computer-use); [Steel](https://github.com/steel-dev/leaderboard) |
| Claude Opus 4.8 | Verified 83.4 (Anthropic revised harness) | 2.0: 55.7 (Anthropic) | [Steel](https://github.com/steel-dev/leaderboard) |
| Claude Sonnet 4.6 | Verified 72.11 (official) / 78.5 (Anthropic) | 2.0: 41.5 (authors, max) | [os-world data](https://github.com/os-world/os-world.github.io/tree/main/static/data); [Steel](https://github.com/steel-dev/leaderboard) |
| Kimi K2.6 / Qwen 3.7 Plus / MiniMax M3 | Verified 73.06 / 73.3 / 75.19 (official) | 2.0: 22.1 / 21.5 / 22.3 (authors) | same |
| **OSWorld 2.x release/subset bridges** | | | |
| Claude Opus 5 | 2.0 full (Anthropic): 70.6 | 2.1 (Anthropic): 74.0 | [Steel](https://github.com/steel-dev/leaderboard); [Anthropic](https://www.anthropic.com/news/claude-opus-5-5) |
| Claude Opus 5 | 2.0 offline 0808 (OpenAI table): 70.2 | 2.1 (Anthropic): 74.0 | [Steel](https://github.com/steel-dev/leaderboard) / [OpenAI Astra](https://openai.com/index/gpt-6-astra/) |
| Claude Fable 5.1 | 2.0 0808, modified (Anthropic): 77.9 | 2.1: 80.7 | [Steel](https://github.com/steel-dev/leaderboard); [Anthropic](https://www.anthropic.com/news/claude-opus-5-5) |
| GPT-5.6 Sol | 2.0 (OpenAI, Jul): 62.6 | 2.0 offline + latency simulation (OpenAI, Sep): 65.7 | [Steel](https://github.com/steel-dev/leaderboard) |
| **Vendor vs independent (OSWorld 2.0 partial)** | | | |
| Claude Opus 5 | Anthropic: 70.6 | Snorkel: 68.31 (binary 31.43) | [Steel](https://github.com/steel-dev/leaderboard) |
| GPT-5.6 Sol | OpenAI: 62.6 | Snorkel: 62.72 (binary 27.34) | same |
| Claude Opus 4.8 | Anthropic: 55.7 | Authors: 54.8 batched / 49.33 standard | same |
| **Effort / tooling (OSWorld 2.0 partial)** | | | |
| Claude Opus 5 | Medium: 60.3 (OpenAI offline) | Max: 70.2 (OpenAI offline) / 70.6 (Anthropic) | [Vellum](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained) (snippet); [Steel](https://github.com/steel-dev/leaderboard) |
| GPT-6 Sol | xhigh: 60.5 | max: 64.4 | [Vellum](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained), [OpenAI 6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/) (snippets) |
| Claude Sonnet 4.6 | Medium: 33.9 (binary 9.3) | Max: 41.5 (binary 8.3) | [Steel](https://github.com/steel-dev/leaderboard) |
| Claude Opus 4.8 / Opus 4.7 | Standard tools: 49.33 / 49.1 (binary 18.52 / 13.9) | Batched: 54.8 / 48.91 (binary 20.6 / 18.2) | same |
| **Partial vs strict (OSWorld 2.x)** | | | |
| Claude Opus 5.5 (2.1) | Partial 81.8 | Strict 48.7 | [Anthropic](https://www.anthropic.com/news/claude-opus-5-5); system card via [llm-stats](https://llm-stats.com/blog/research/claude-opus-5-5-launch) (snippet) |
| Fable 5.1 / Muse Spark 1.3 / Simular Sai | 77.9 / 66.9 / 73.0 | 41.7 / 32.0 / 28.25 | [Steel](https://github.com/steel-dev/leaderboard) |
| GPT-5.5 batched / Qwen3.8-Flash-Next / MiniMax M3 | 49.5 / 52.3 / 22.3 | 13.0 / 19.4 / 4.6 | same |
| **OSWorld original observation modes** | | | |
| GPT-4V | Screenshot 5.26 | Screenshot + a11y 12.17; SoM 11.77 | [os-world data](https://github.com/os-world/os-world.github.io/tree/main/static/data) |
| GPT-4o | Screenshot 5.03 | A11y 11.36; screenshot + a11y 11.21; SoM 4.59 | same |
| **Browser benchmarks** | | | |
| Claude Opus 5 (BrowseComp) | Anthropic card: 90.8 | OpenAI Astra table: 90.8 | [Steel](https://github.com/steel-dev/leaderboard) |
| Mythos 5 / Opus 4.8 / Sonnet 5 / GPT-5.6 Sol (BrowseComp) | Single agent: 88.0 / 84.3 / 84.7 / 90.4 | Multi-agent: 93.3 / 88.5 / 86.6 / 92.2 (Ultra) | same |
| GLM-4.7 / Qwen3.5-397B / Kimi K3 (BrowseComp) | Standard / folding / full context: 52.0 / 69.0 / 90.4 | Context-managed: 67.5 / 78.6 / 91.2 | same |
| GPT-5 (BrowseComp-Plus) | BM25 retriever: 55.9 | Qwen3-Embedding-8B: 70.1 | [arXiv 2508.06600](https://arxiv.org/abs/2508.06600) (snippet) |
| Navigator / Gemini 2.5 CU / Claude 4.0 / Claude 4.5 / Operator (Online-Mind2Web) | Human eval: 78.7 / 69.0 / 61.0 / 55.0 / 61.3 | WebJudge: 64.7 / 57.3 / 47.7 / 59.3 / 71.8 | [Steel](https://github.com/steel-dev/leaderboard) |
| Notte (WebVoyager) | Own harness: 86.2 | LLM eval: 79.0 | same |
| Claude Opus 4.6 (HealthAdminBench) | Native CUA: 36.3 | Standardized screenshot: 14.8; a11y tree: 51.9 | [arXiv 2604.09937](https://arxiv.org/abs/2604.09937) via [Steel](https://github.com/steel-dev/leaderboard) |
| GPT-5.4 (HealthAdminBench) | Native CUA: 26.7 | Standardized harness: 5.9 | same |
