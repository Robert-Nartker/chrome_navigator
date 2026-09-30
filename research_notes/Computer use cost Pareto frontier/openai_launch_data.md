# OpenAI GPT-6 Astra / GPT-6.1 Sol / GPT-6 Sol / GPT-6 Luna: computer-use and browser-use launch data by reasoning effort

**Method note (read first):** Every WebFetch attempt was refused by the egress proxy. That covered openai.com, deploymentsafety.openai.com, vellum.ai, datacamp.com, digitalapplied.com, kingy.ai, thenextweb.com, venturebeat.com, neowin.net, handyai.substack.com, leaderboard.steel.dev and paperswithcode.co. developers.openai.com and openrouter.ai were known to be blocked beforehand. **So every number below comes from WebSearch result snippets, not from reading the pages.** When a snippet quoted an OpenAI post, the OpenAI URL is cited as the original, together with the host whose snippet carried the number. A snippet merges text from several results, so the exact host behind a number is sometimes uncertain; those cases say so. I could not see any chart images, so **there are no chart-read estimates in this file**. Each point below is a number that a snippet stated as text.

Launch timeline (dates from snippets):
- GPT-6 Astra: 2026-09-03 ([DataNorth](https://datanorth.ai/news/openai-launches-gpt-6-astra)). Rollout was gated because Astra is the first OpenAI model rated "Critical" for cybersecurity under the Preparedness Framework ([DataNorth](https://datanorth.ai/news/openai-launches-gpt-6-astra)).
- GPT-6 Sol and GPT-6 Luna: 2026-09-22 ([MarkTechPost](https://www.marktechpost.com/2026/09/22/openai-releases-gpt-6-sol-and-luna-50-cheaper-api-pricing-and-benchmarks/); [OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/)).
- Image-encoding bug fix for GPT-6 Sol and Luna: 2026-09-25 ([Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-image-bug-fix-rerun-evals)).
- GPT-6.1 Sol (`gpt-6.1-sol`): 2026-09-29, at DevDay 2026 ([TechCrunch](https://techcrunch.com/2026/09/29/openai-launches-gpt-6-1-sol-says-it-nearly-matches-gpt-6-astra-and-costs-less/); [Unite.AI](https://www.unite.ai/openai-unveils-gpt-6-1-sol-at-devday-with-new-codex-and-chatgpt-tools/); [GitHub Changelog](https://github.blog/changelog/2026-09-29-gpt-6-1-sol-in-github-copilot/)).

## Q1. What computer-use, browser-use and GUI-agent scores did OpenAI publish for GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol and GPT-6 Luna?

### Takeaway
OpenAI's one computer-use benchmark in all three launches is **OSWorld 2.0, offline set, August 8 (0808) release, partial-reward score**. Most numbers are reported at max effort, and some at xhigh or low. The headline max-effort results are:
- GPT-6 Astra: 72.6% at launch (effort not firmly stated), then **73.5% at max** in the GPT-6.1 Sol post, at about $9.07–$9.30 per task.
- GPT-6.1 Sol: **71.4% at max, $1.27 per task**.
- GPT-6 Sol: **64.4% at max, $3.37 per task**; 60.5% at xhigh, $2.21 per task; 43.9% at low.
- GPT-6 Luna: **52.7% at max, $0.27 per task**; 8.3% at low.

The only browser benchmark number found for the GPT-6 family is BrowseComp for Astra (91.5%). I found no WebArena, Online-Mind2Web, WebVoyager, ScreenSpot-Pro, OSWorld-Verified or tau-bench numbers for any of the four models.

### Cited Findings

**Benchmark variant definitions**
- OpenAI reports "OSWorld 2.0's offline set from the August 8 release with partial reward". Anthropic instead reports "OSWorld 2.1 partial-credit results", and "different versions and subsets prevent a clean computer-use head-to-head comparison" between GPT-6.1 Sol and Claude Opus 5.5. — search snippet attributed to [Kingy AI, GPT-6.1 Sol vs Claude Opus 5.5](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/)
- The OSWorld 2.0 "0808 offline" subset has **82 tasks**. "Partial is the mean normalized task score and Binary is the full-credit rate; both use all 82 tasks with equal weighting." The 06.24 and 08.08 releases change tasks and grading. — [Papers with Code: OSWorld 2.0 (0808 offline, 82 tasks)](https://paperswithcode.co/benchmark/osworld-2-0-0808-offline-82-tasks) (snippet)
- The full OSWorld 2.0 has 108 long-horizon tasks across 31 self-hosted web environments and professional desktop apps. Partial credit is scored over an average of 27.25 checkpoints per task, and a skilled human needs a median of about 1.6 hours per task. — [Snorkel AI leaderboard](https://snorkel.ai/leaderboard/os-world-2-0/); [OSWorld 2.0 paper, arXiv 2606.29537](https://arxiv.org/html/2606.29537v1) (snippets)
- OSWorld 2.0 is scored at **150, 300 and 500 agent-step budgets**. "Tracked scores use the default 500-step budget", and one leaderboard snippet described Astra's 72.6% as a 500-step partial score. **I could not confirm from OpenAI's own text which step budget OpenAI used.** — [Snorkel AI](https://snorkel.ai/leaderboard/os-world-2-0/); [Yutori OSWorld 2.0 leaderboard](https://yutori.com/leaderboards/osworld-2); [Steel.dev](https://leaderboard.steel.dev/leaderboards/osworld-2/) (snippets)
- An Astra launch footnote reportedly says that Astra "ran on a modified Responses API harness that changed two settings to better match real-world performance". — [llm-stats Astra launch blog](https://llm-stats.com/blog/research/gpt-6-astra-launch) / [BenchLM](https://benchlm.ai/models/gpt-6-astra) (snippet; which two settings is unknown)

**GPT-6 Astra (launch post, 2026-09-03)**
- OSWorld 2.0, offline partial set: **72.6%** in "about 40 simulated minutes per task", against **65.7%** for GPT-5.6 Sol in about 75 minutes. — [OpenAI, GPT-6 Astra](https://openai.com/index/gpt-6-astra/) via [llm-stats](https://llm-stats.com/blog/research/gpt-6-astra-launch), [Emergent](https://emergent.sh/learn/gpt-6-astra-benchmarks) and [MindStudio](https://www.mindstudio.ai/blog/gpt-6-astra-computer-use-agentic) (snippets)
- The effort behind the 72.6% is uncertain. One snippet says "these benchmark numbers were run at maximum effort". Another says "an xhigh configuration is generally available at launch, while a max reasoning configuration ... arrives after further safety testing." — [Emergent](https://emergent.sh/learn/gpt-6-astra-benchmarks) / [DataCamp](https://www.datacamp.com/blog/gpt-6-astra) (snippets; conflicting)
- BrowseComp: **91.5%**, against 90.4% for GPT-5.6 Sol. Effort and tool configuration are not stated in any snippet. — [OpenAI](https://openai.com/index/gpt-6-astra/) via [Vellum](https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained), [MindStudio](https://www.mindstudio.ai/blog/gpt-6-astra-benchmarks-analysis) and [llm-stats](https://llm-stats.com/blog/research/gpt-6-astra-launch) (snippets)
- AutomationBench (business workflows across apps): **41.4%**, against 18.1% for GPT-5.6 Sol. Terminal-Bench 4.0: 57.7. — [MindStudio](https://www.mindstudio.ai/blog/gpt-6-astra-computer-use-agentic); [llm-stats](https://llm-stats.com/blog/research/gpt-6-astra-launch) (snippets)

**GPT-6 Astra (as re-stated in the GPT-6.1 Sol post, 2026-09-29)**
- OSWorld 2.0 offline set at **max effort: 73.5%**. — [OpenAI, Introducing GPT-6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/) via the table in [HandyAI "Model Drop: GPT-6.1 Sol"](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippet)
- Astra's max-effort cost per task on OSWorld 2.0: **$9.07** in one snippet and **$9.30** in another ("$1.30 vs $9.30"). Both fit OpenAI's wording that GPT-6.1 Sol costs "roughly one-seventh" as much. — the $9.07 snippet came from a result set with [CometAPI](https://www.cometapi.com/gpt-6-astra-price/), [KbWen](https://www.kbwen.com/gpt-6-astra-cost-per-token-and-per-task/) and [Kingy Sol vs Astra](https://kingy.ai/blog/gpt-6-sol-vs-astra-effort-pricing/); the $9.30 snippet came from [Agentpedia](https://agentpedia.codes/blog/gpt-6-1-sol-guide) / [byteiota](https://byteiota.com/gpt-61-sol-pricing-developer-guide/) (host uncertain for both)

**GPT-6.1 Sol (2026-09-29)**
- OpenAI's text: "On OSWorld 2.0's offline set ... GPT-6.1 Sol outperforms GPT-6 Sol by seven percentage points at maximum reasoning effort at less than half the cost ... comes within 2.1 percentage points of Astra's score at maximum reasoning effort at roughly one-seventh the cost per task." — [OpenAI](https://openai.com/index/introducing-gpt-6-1-sol/) (snippet)
- The HandyAI table row reads: "OSWorld 2.0, offline set: **71.4% (max)**, −2.1 under GPT-6 Astra (73.5%) at **$1.27 a task**, +7.0 over GPT-6 Sol (64.4%), +5.7 over GPT-5.6 Sol (65.7%)". — [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippet)
- "The cost per task drops from **$3.37 to $1.27** at maximum reasoning effort", meaning GPT-6 Sol at max ($3.37) against GPT-6.1 Sol at max ($1.27). — snippet from a result set containing [OpenAI](https://openai.com/index/introducing-gpt-6-1-sol/), [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol), [Runtimewire](https://runtimewire.com/article/openai-gpt-6-1-sol-cuts-frontier-model-pricing) and [Agentpedia](https://agentpedia.codes/blog/gpt-6-1-sol-guide)
- Another snippet gives "$1.30 vs $9.30" for 6.1 Sol against Astra, which conflicts slightly with $1.27. — [Agentpedia](https://agentpedia.codes/blog/gpt-6-1-sol-guide) / [byteiota](https://byteiota.com/gpt-61-sol-pricing-developer-guide/) (snippet)
- AutomationBench 1.0.6: **36.1% (max)**, against GPT-6 Astra 41.4%, Opus 5.5 "with fallbacks" 42.5% and GPT-6 Sol 33.2%. — [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippet)
- Related agentic, non-GUI results from the same table: GDP.pdf 32.0% (high); DeepSWE v1.1 75.2% (high); Terminal-Bench Science 0.1 57.0% (max). — [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippet)
- **Warning about a common conflation:** several snippets pair "$5.47 per task vs $23.21 for Opus 5.5 / $23.80 for Astra" with OSWorld. In fact these are **Terminal-Bench Science** costs: 57.0% against Astra's 68.1% is an 11-point gap, which matches the headline "GPT-6.1 Sol's $5.47 Task Scores 11 Points Below Astra's $23.80". **Do not plot them as OSWorld points.** — [THE D*AI*LY BRIEF (beri.net)](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task) (headline)
- No GPT-6.1 Sol BrowseComp number appeared in any search.

**GPT-6 Sol (predecessor of 6.1 Sol; 2026-09-22)**
- OpenAI's text: "On OSWorld 2.0 offline, GPT-6 Sol at **xhigh** effort achieves a similar score to Claude Opus 5 at **medium** effort — **60.5% versus 60.3%** — at approximately 80% lower cost per task." — [OpenAI, Introducing GPT-6 Sol and Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/) (snippet)
- Dollar figures: "OpenAI's comparison is Sol at xhigh (**60.5%, $2.21**) vs. Opus 5 at medium (**60.3%, $12.67**), about 83% cheaper." — [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) (snippet)
- Low effort: GPT-6 Sol scores **43.9%** on OSWorld 2.0, "rising to 60.5% at xhigh". One snippet tied this curve to GPT-6.1 Sol, but the 60.5% xhigh endpoint matches GPT-6 Sol's published xhigh score, so it is GPT-6 Sol's curve. — snippet from a result set including [Emergent GPT-6 Sol benchmarks](https://emergent.sh/learn/gpt-6-sol-benchmarks), [Kingy Sol vs Astra](https://kingy.ai/blog/gpt-6-sol-vs-astra-effort-pricing/) and [Vellum Sol/Luna](https://www.vellum.ai/blog/gpt-6-sol-and-luna-benchmarks-explained) (host uncertain)
- Max effort: **64.4%**, restated in the 6.1 Sol post, at **$3.37 per task** (see above). A Sol/Luna-launch snippet also says: "on DeepSWE and OSWorld 2.0, GPT-6 Sol's best score (68.8% and 64.4%) is below GPT-5.6 Sol's best (72.7% and **66.2%**)". — [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) / [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-launch-pricing-benchmarks-2026) (snippet). **Conflict:** the Astra and 6.1 Sol posts give GPT-5.6 Sol's OSWorld 2.0 score as 65.7%, not 66.2%.
- AutomationBench: "GPT-6 Sol at **xhigh** effort scores **33.2% at $0.27 per task**, ahead of Claude Opus 5 at max effort and even ahead of low-effort GPT-6 Astra", which is "9% of Opus 5's cost per task". — [OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/) via [DataCamp](https://www.datacamp.com/blog/gpt-6-sol-and-luna) / [VentureBeat](https://venturebeat.com/technology/openai-releases-gpt-6-sol-and-luna-models-slashing-api-costs-50-or-more) (snippet. The $0.27 is the same as Luna's OSWorld cost, so confirm it before plotting.)
- No GPT-6 Sol BrowseComp number found.

**GPT-6 Luna (2026-09-22)**
- OpenAI's text: "GPT-6 Luna (max) is able to exceed GPT-5.6 Sol (medium) at one tenth of its cost." In numbers: **Luna max 52.7% at $0.27 per task** against **GPT-5.6 Sol medium 49.7% at $2.73**. — [OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/) via [Puter developer blog](https://developer.puter.com/blog/gpt-6-sol-luna-review/) and [Emergent Luna benchmarks](https://emergent.sh/learn/gpt-6-luna-benchmarks) (snippets)
- "Luna's top score is flat against its predecessor (52.7% for both) at about 45% lower cost", meaning GPT-5.6 Luna's best OSWorld 2.0 score was also 52.7%. — same snippet set
- Low effort: "Luna at low effort scores **8.3%** on OSWorld". — snippet from a result set including [Emergent Luna benchmarks](https://emergent.sh/learn/gpt-6-luna-benchmarks), [Tosea](https://tosea.ai/blog/gpt-6-sol-luna-complete-guide) and [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) (host uncertain)
- **Not an OSWorld number:** 66.6% for Luna at max is **DeepSWE v1.1**, "comparable to Claude Opus 5 and Fable 5 at medium effort" at 93%/96% lower cost per task. Luna max and Sol xhigh both reach 66.6% on DeepSWE, at $0.22 and $1.00 per task. — [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) (snippet). Some snippets wrongly attach this 66.6% to OSWorld.
- AutomationBench: "At high effort, GPT-6 Luna improves on its predecessor by 5.4 percentage points at 58% lower cost per task." — [OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/) via search snippet
- GPT-5.6 Luna (predecessor) BrowseComp: 83.3%. No GPT-6 Luna BrowseComp found. — [Vellum GPT-5.6](https://www.vellum.ai/blog/gpt-5-6-benchmarks-explained) (snippet)

**Image-bug caveat that affects GPT-6 Sol and Luna computer-use numbers**
- On 2026-09-25 OpenAI fixed an image-encoding bug that had "degraded how the models understood images" in GPT-6 Sol and Luna. OpenAI's developer account said the fix improves visual tasks in the API and Codex, "including computer use". — [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-image-bug-fix-rerun-evals); [Shakthi on X](https://x.com/v_shakthi/status/2104394957964595672) (snippets)
- After the fix, GPT-6 Luna's RefCOCOg visual-localization IoU rose from 28.8% to 60.0%, and hard text extraction rose from 66.67% to 84.88%. — [KuCoin news flash](https://www.kucoin.com/news/flash/openai-fixes-gpt-6-image-bug-luna-s-visual-localization-doubles); [HuggingNews](https://huggingnews.com/ai/openai-fixes-gpt-6-vision-bug-to-raise-lunas-text-extraction-to-85percen-1573fdc2) (snippets)
- I found no re-run OSWorld 2.0 numbers for GPT-6 Sol or Luna after the fix. A GitHub issue on a third-party benchmark asks whether results need re-running. — [phuryn/bug-hunt-bench #6](https://github.com/phuryn/bug-hunt-bench/issues/6)

**Third-party computer-use data (not OpenAI)**
- RecreationWorld (hybrid computer-use agents, arXiv): GPT-6 Astra 58.06%, Claude Opus 5 44.16%, GPT-5.6 Sol 42.06%. Effort not stated. — [arXiv 2609.22000](https://arxiv.org/pdf/2609.22000) (snippet)
- An OSWorld 2.0 leaderboard snippet from early September 2026: "GPT-6 Astra leads at 72.6%, followed closely by Claude Opus 5 at 70.6% (in partial score at 500 steps)". The Opus 5 figure is presumably not the medium-effort point that OpenAI charted (60.3%). — [Yutori](https://yutori.com/leaderboards/osworld-2) / [BenchLM OSWorld 2.0](https://benchlm.ai/benchmarks/osworld2) (host uncertain)

### Inferences
- GPT-6 Sol at max ($3.37, 64.4%) is **dominated** by GPT-6.1 Sol at max ($1.27, 71.4%): 6.1 Sol scores higher at lower cost. That is a 62% lower cost per task for +7.0 pp.
- GPT-6.1 Sol at max against Astra at max: −2.1 pp for about 86% less cost ($1.27 against $9.07, a ratio of 0.14). Using $9.30 changes this very little.
- GPT-6 Sol's OSWorld effort curve rises steeply: low 43.9%, xhigh 60.5% ($2.21), max 64.4% ($3.37). Going from xhigh to max adds +3.9 pp for +$1.16 per task (+52% cost).
- Luna's OSWorld curve has a very low floor (8.3% at low) and tops out at 52.7% ($0.27) at max. On a Pareto chart, Luna max sits about 8× cheaper than GPT-6 Sol xhigh but 7.8 pp lower.
- The GPT-6 Sol and Luna OSWorld points were published before the 2026-09-25 image fix. They probably understate post-fix performance. This is an inference; OpenAI has published no re-run.
- The Astra gap (72.6% at launch against 73.5% at max in the 6.1 Sol post) fits the launch number being xhigh, or a pre-GA configuration, with max added later. This is not confirmed, so both numbers should stay labelled.

### Gaps
- I found no OSWorld 2.0 score or cost for **GPT-6.1 Sol at low, medium, high or xhigh**; only max was quoted in text. The 6.1 Sol post probably has a cost-vs-score chart, but I could not view it.
- Missing GPT-6 Sol OSWorld points: medium and high scores, and the cost at low. Missing GPT-6 Luna points: none, medium, high and xhigh, and the cost at low.
- Astra OSWorld 2.0 at low, medium, high and xhigh (score and cost) was not found.
- I found no tokens per task for any OSWorld run. Costs are only in dollars.
- The step budget OpenAI used on OSWorld 2.0 is unconfirmed (500 is probable). Pass@1 or best-of-N is not stated in any snippet; partial-reward scoring is confirmed.
- No GPT-6-family numbers were found for OSWorld-Verified, WebArena, Online-Mind2Web, WebVoyager, ScreenSpot-Pro or tau-bench. BrowseComp exists only for Astra (91.5%), with unknown effort and tool setup.
- I could not read the system cards (deploymentsafety.openai.com is blocked) to check for Operator or agent-mode evaluations.

## Q2. Which reasoning efforts do the models support, and did OpenAI publish score-vs-effort, score-vs-cost or Pareto charts?

### Takeaway
GPT-6 Sol and GPT-6 Luna accept six efforts, **none, low, medium (default), high, xhigh and max**. GPT-6.1 Sol and GPT-6 Astra accept five, **low, medium (default), high, xhigh and max**; Astra's max arrived after safety testing. OpenAI's launch charts put **score (y) against cost per task in USD (x)** at every effort level, with Claude Opus 5 and Fable 5 on the Sol/Luna charts and Claude Opus 5.5 on the 6.1 Sol post. Only the individual points listed above were stated in text.

### Cited Findings
- GPT-6 Sol and Luna support "six reasoning-effort settings ... from none to max with a default of medium". — [Requesty](https://www.requesty.ai/blog/gpt-6-sol-luna-pricing-release-api) / [Powerdrill](https://powerdrill.ai/blog/gpt-6-sol-and-luna) (snippet)
- GPT-6 Luna's `reasoning.effort` accepts none, low, medium (default), high, xhigh and max. "Most of OpenAI's headline results were run at xhigh or max." — [DataCamp Sol/Luna](https://www.datacamp.com/blog/gpt-6-sol-and-luna) / [Tosea](https://tosea.ai/blog/gpt-6-sol-luna-complete-guide) (snippet)
- GPT-6.1 Sol "supports low, medium (the default), high, xhigh, and max reasoning effort". — [DataCamp 6.1 Sol](https://www.datacamp.com/blog/gpt-6-1-sol) / [Kingy 6.1 Sol vs Opus 5.5](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/) (snippets)
- Astra "exposes a graduated reasoning effort control with low, medium, high, xhigh and max settings". xhigh was GA at launch, and max "arrives after further safety testing". — [DataCamp Astra](https://www.datacamp.com/blog/gpt-6-astra) / [Vellum Astra](https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained) (snippet)
- The chart description reads: "OpenAI charted score against cost per task at all five reasoning-effort settings (low, medium, high, xhigh, max) for GPT-6 Sol, GPT-6 Luna, GPT-6 Astra, and other models". — snippet from the Sol/Luna coverage set ([ComputingForGeeks](https://computingforgeeks.com/gpt-6-sol-luna-released-features-benchmarks/), [Kingy](https://kingy.ai/blog/gpt-6-sol-luna-specs-benchmarks-pricing-comparison/), [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-launch-pricing-benchmarks-2026); host uncertain). Whether the x-axis is log scale is **unknown**.
- The Sol/Luna charts compared against **Claude Opus 5** (medium and max) and **Fable 5** (medium). On OSWorld, the comparison stated in text is GPT-6 Sol xhigh at 60.5% for $2.21 against Opus 5 medium at 60.3% for $12.67. — [OpenAI](https://openai.com/index/introducing-gpt-6-sol-and-luna/) via [AI Catchup](https://aicatchup.com/news/openai-gpt-6-sol-luna) (snippet)
- The 6.1 Sol post compared against **Claude Opus 5.5** ("with fallbacks") on AutomationBench, GDP.pdf and Terminal-Bench Science. The snippets show no Opus 5.5 point on OpenAI's OSWorld 2.0 chart, and one caveat notes that Anthropic reports OSWorld 2.1 instead. — [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol); [Kingy](https://kingy.ai/blog/gpt-6-1-sol-vs-claude-opus-5-5/) (snippets)
- Independent effort-vs-cost data for Astra appeared in snippets, but it is **not computer use**. Two incompatible series showed up: "$0.63 low, $1.16 medium, $1.41 high, $1.85 xhigh, $2.57 max, for index scores of 49–55", and "$0.46 at low to $1.67 at max, intelligence score 57 to 61". These are probably Artificial Analysis index runs. — [Artificial Analysis Astra](https://artificialanalysis.ai/models/releases/gpt-6-astra) / [paddo.dev](https://paddo.dev/blog/gpt-6-astra-critical-generally-available/) (snippets; attribution uncertain; **do not use for the CU chart**)

### Inferences
- The chart points recoverable from text are all tied to OpenAI's OSWorld 2.0 (0808 offline, partial) cost-per-task axis, so they can go on one chart. The Opus 5 comparison point (60.3%, $12.67, medium) is on the same axis because it comes from OpenAI's own harness.
- The user noted that `none` works on the live API for Luna but not for 6.1 Sol or Astra. That matches the snippets. GPT-6 Sol reportedly also accepts `none`; this could not be checked live here.

### Gaps
- I could not see any chart image, so none of the unlabelled effort points could be read off an axis.
- Whether OpenAI drew a "Pareto frontier" line is unverified.

## Q3. What changed from GPT-6 Sol to GPT-6.1 Sol on agentic and computer-use benchmarks?

### Takeaway
At max effort on OSWorld 2.0 offline, 6.1 Sol scores **+7.0 pp (64.4% to 71.4%)** while cost per task falls **about 62% ($3.37 to $1.27)**. AutomationBench rises +2.9 pp, comparing 6.1 Sol at max with GPT-6 Sol's 33.2%, which was published at xhigh. Terminal-Bench Science rises +29.4 pp. List prices are unchanged except cached input, which halves.

### Cited Findings
- OSWorld 2.0 offline: 71.4% at max against GPT-6 Sol's 64.4% (+7.0), "at less than half the cost"; $3.37 falls to $1.27. — [OpenAI](https://openai.com/index/introducing-gpt-6-1-sol/); [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippets)
- AutomationBench 1.0.6: 36.1% (max) against GPT-6 Sol's 33.2% (+2.9). Terminal-Bench Science 0.1: 57.0% (max) against 27.6% (+29.4). DeepSWE v1.1: 75.2% (high) against 68.8% (+6.4). GDP.pdf: 32.0% (high) against 28.0% (+4.0). — [HandyAI](https://handyai.substack.com/p/model-drop-gpt-61-sol) (snippet)
- OpenAI's framing is "stronger agentic coding and computer use, near-Astra performance, and cached input at a 95% discount to standard input pricing". — [OpenAI Developers on X](https://x.com/OpenAIDevs/status/2104993035507712318) (snippet)
- Effort ladder: 6.1 Sol drops `none` (low, medium, high, xhigh, max), while GPT-6 Sol offered none through max. — [DataCamp](https://www.datacamp.com/blog/gpt-6-1-sol); [Requesty](https://www.requesty.ai/blog/gpt-6-sol-luna-pricing-release-api) (snippets)

### Inferences
- GPT-6 Sol was benchmarked before the Sept 25 image fix, and 6.1 Sol after it. Part of the 6.1 gain on OSWorld may come from the image-encoding fix rather than the model itself. This is unverified. The 6.1 post reuses 64.4% for GPT-6 Sol, the same as its launch number, which suggests GPT-6 Sol was not re-run.

### Gaps
- There is no public per-effort comparison below max for OSWorld, and no tokens-per-task comparison.

## Q4. What is the official API pricing, including tiers, long-context surcharges and screenshot billing?

### Takeaway
Standard prices per million tokens (input / cached input / output):
- **GPT-6 Astra: $10 / $1 / $50**
- **GPT-6.1 Sol: $2 / $0.10 / $10**
- **GPT-6 Sol: $2 / $0.20 / $10**
- **GPT-6 Luna: $0.10 / $0.01 / $0.50**

Batch and Flex cost 50% of Standard. Fast/priority mode costs 2×. Requests above **272K input tokens** bill the whole request at 2× input and cache rates and 1.5× output. Cache writes cost 1.25× the uncached input rate. Images are billed as input tokens under a patch budget.

### Cited Findings
- Astra: $10 input, $1 cached, $12.50 cache write, $50 output at or under 272K. Above 272K the rates are "$20 in and $75 out". "Batch and Flex halve those rates, Fast mode doubles them, and cache writes bill at 1.25 times the uncached input rate." — [Yotta Labs](https://www.yottalabs.ai/post/gpt-6-astra-pricing-api-cost-2026); [Layer3Labs](https://www.layer3labs.io/guides/gpt-6-astra-api-pricing); [CloudZero](https://www.cloudzero.com/blog/gpt-6-pricing/) (snippets)
- GPT-6.1 Sol: "$2 per million input tokens, $0.10 per million cached input tokens, and $10 per million output tokens". That is one-fifth of Astra's $10/$50. — [OpenAI](https://openai.com/index/introducing-gpt-6-1-sol/); [TheNextWeb](https://thenextweb.com/news/openai-gpt-6-1-sol-price-astra-devday); [The Rundown](https://www.therundown.ai/tools/gpt-6-1-sol) (snippets)
- Sol tiers (documented): "Batch and Flex processing are 50% of Standard and Fast mode is priced at 2x the applicable Standard rate. Prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full request." "GPT-6.1 Sol Ultrafast is still forthcoming": an upcoming Codex option with up to 8× faster generation that OpenAI does not yet offer for 6.1 Sol. — [Developers Digest](https://www.developersdigest.tech/blog/gpt-6-1-sol-release-guide-2026); [BuildFastWithAI](https://blog.buildfastwithai.com/gpt-6-1-sol-review); [senpi issue #2390](https://github.com/code-yeongyu/senpi/issues/2390) (snippets). VentureBeat's headline says "a new Ultrafast tier clocks at 300 tokens per second". — [VentureBeat](https://venturebeat.com/technology/openais-gpt-6-1-sol-offers-astra-like-performance-at-1-5th-price-a-new-ultrafast-tier-clocks-at-300-tokens-per-second)
- GPT-6 Sol: $2 input / $10 output, down from $4/$20 for GPT-5.6 Sol. Cached input is $0.20 (a 90% discount). — [gHacks](https://www.ghacks.net/2026/09/23/openai-launches-gpt-6-sol-and-luna-with-50-lower-api-pricing-than-gpt-5-6/); [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/openai-cuts-gpt-6-sol-111351382.html) (snippets)
- GPT-6 Luna: $0.10 input, $0.01 cached, $0.125 cache write, $0.50 output at or under 272K, down from $0.20/$1.20 for GPT-5.6 Luna. An OpenAI spokesperson told VentureBeat the rates carry no expiration date. — [eesel AI](https://www.eesel.ai/blog/gpt-6-luna-pricing); [VentureBeat](https://venturebeat.com/technology/openai-releases-gpt-6-sol-and-luna-models-slashing-api-costs-50-or-more) (snippets)
- Long-context rule for Sol and Luna: over 272K is billed at "2x the input and cache rates and 1.5x the output rate". Cached input is 10% of uncached, and cache writes are 1.25×. — [Digital Applied image-fix article](https://www.digitalapplied.com/blog/gpt-6-sol-luna-image-bug-fix-rerun-evals) (snippet)
- Context window: GPT-6 Sol and Luna have 1,050,000 tokens, a 922,000-token single-input cap and 128,000 max output. GPT-6.1 Sol has 1,050,000 context and 128,000 max output. — [Requesty](https://www.requesty.ai/blog/gpt-6-sol-luna-pricing-release-api); [The Rundown](https://www.therundown.ai/tools/gpt-6-1-sol) (snippets)
- Images and screenshots: all GPT-6 tiers take text and image input. "gpt-6-astra with detail: high uses a 65,535-pixel maximum dimension, a 2,500-patch budget, and a 1.2× multiplier" on image tokens. A generic line adds that "for tool-specific models, like search and computer use, there's a fee per tool call". — [Puter OpenAI pricing](https://developer.puter.com/tutorials/openai-api-pricing/) / [CloudZero OpenAI pricing](https://www.cloudzero.com/blog/openai-pricing/) (snippets; OpenAI's [image cost calculator](https://developers.openai.com/api/docs/guides/image-cost-calculator) was blocked)

### Inferences
- Derived cache-write prices (1.25× input, not directly quoted for these models): about $2.50/M for GPT-6 Sol and GPT-6.1 Sol.
- Screenshot-heavy computer-use loops will be dominated by input and cached-input tokens. 6.1 Sol's $0.10 cached rate (95% off) is therefore a large share of the $3.37-to-$1.27 per-task drop. This is an inference.

### Gaps
- Patch budgets and multipliers for gpt-6-sol, gpt-6.1-sol and gpt-6-luna images were not found.
- The per-call fee, if any, for the computer-use tool with GPT-6 models was not found.
- Priority-tier prices in dollars (beyond "2×") were not confirmed on OpenAI's page, which is blocked.

## Q5. Did OpenAI report average tokens or cost per task for agentic or computer-use evaluations by effort?

### Takeaway
OpenAI reports **dollar cost per task** (not tokens) on its cost-vs-score charts. The OSWorld 2.0 dollar figures that surfaced as text are these: Astra max $9.07–$9.30; 6.1 Sol max $1.27; GPT-6 Sol xhigh $2.21 and max $3.37; Luna max $0.27; GPT-5.6 Sol medium $2.73; Opus 5 medium $12.67. Astra also has a time figure (about 40 simulated minutes per task, against about 75 for GPT-5.6 Sol).

### Cited Findings
- See the Q1 citations for each dollar figure.
- AutomationBench: GPT-6 Sol xhigh costs $0.27 per task, "9% of Opus 5's cost per task" at max, which implies roughly $3.0 per task for Opus 5 (derived). — [DataCamp Sol/Luna](https://www.datacamp.com/blog/gpt-6-sol-and-luna) (snippet)

### Gaps
- No tokens-per-task figures were found for any model or effort.

## Consolidated data table

Everything is OSWorld 2.0 = "OSWorld 2.0, offline set, 08.08 release (82 tasks), partial-reward (mean normalized task score)" unless the row says otherwise. OpenAI's step budget is unconfirmed; 500 is likely. Every row is a **search-snippet** value because fetches were blocked. "Official" means the snippet quotes or restates OpenAI's own launch material.

| model | reasoning effort | benchmark (exact variant + step budget) | score | tokens or $ per task if given | source URL | date | confidence |
|---|---|---|---|---|---|---|---|
| GPT-6 Astra | max | OSWorld 2.0 offline 0808, partial; steps n/s | 73.5% | $9.07/task (another snippet: $9.30) | https://openai.com/index/introducing-gpt-6-1-sol/ ; https://handyai.substack.com/p/model-drop-gpt-61-sol | 2026-09-29 | official (via snippet); $ conflict |
| GPT-6 Astra | not firmly stated (snippets say max; max may not have been GA at launch) | OSWorld 2.0 offline partial ("offline partial set"); 500 steps per a leaderboard snippet | 72.6% | ~40 simulated min/task; $ n/a | https://openai.com/index/gpt-6-astra/ ; https://llm-stats.com/blog/research/gpt-6-astra-launch | 2026-09-03 | official (via snippet); effort uncertain |
| GPT-6 Astra | n/s | BrowseComp (tool config n/s) | 91.5% | n/a | https://openai.com/index/gpt-6-astra/ ; https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained | 2026-09-03 | official (via snippet) |
| GPT-6 Astra | n/s (6.1 post comparison) | AutomationBench 1.0.6 | 41.4% | n/a | https://handyai.substack.com/p/model-drop-gpt-61-sol | 2026-09-29 | official (via snippet) |
| GPT-6.1 Sol | max | OSWorld 2.0 offline 0808, partial | 71.4% | $1.27/task (another snippet: $1.30) | https://openai.com/index/introducing-gpt-6-1-sol/ ; https://handyai.substack.com/p/model-drop-gpt-61-sol | 2026-09-29 | official (via snippet) |
| GPT-6.1 Sol | max | AutomationBench 1.0.6 | 36.1% | n/a | https://handyai.substack.com/p/model-drop-gpt-61-sol | 2026-09-29 | official (via snippet) |
| GPT-6.1 Sol | low / medium / high / xhigh | OSWorld 2.0 offline 0808 | not found | not found | (chart on https://openai.com/index/introducing-gpt-6-1-sol/ not viewable) | n/a | gap |
| GPT-6 Sol (predecessor) | max | OSWorld 2.0 offline 0808, partial | 64.4% | $3.37/task | https://openai.com/index/introducing-gpt-6-1-sol/ ; https://handyai.substack.com/p/model-drop-gpt-61-sol ; https://aicatchup.com/news/openai-gpt-6-sol-luna | 2026-09-22 (restated 09-29) | official (via snippet); pre-image-fix |
| GPT-6 Sol (predecessor) | xhigh | OSWorld 2.0 offline 0808, partial | 60.5% | $2.21/task | https://openai.com/index/introducing-gpt-6-sol-and-luna/ ; https://aicatchup.com/news/openai-gpt-6-sol-luna | 2026-09-22 | official (via snippet); pre-image-fix |
| GPT-6 Sol (predecessor) | low | OSWorld 2.0 offline 0808, partial | 43.9% | n/a | https://emergent.sh/learn/gpt-6-sol-benchmarks (host uncertain) | 2026-09-22 | third-party restating OpenAI chart; one snippet misattributes it to 6.1 Sol |
| GPT-6 Sol (predecessor) | xhigh | AutomationBench | 33.2% | $0.27/task | https://www.datacamp.com/blog/gpt-6-sol-and-luna ; https://openai.com/index/introducing-gpt-6-sol-and-luna/ | 2026-09-22 | official (via snippet); $ needs confirmation |
| GPT-6 Luna | max | OSWorld 2.0 offline 0808, partial | 52.7% | $0.27/task | https://openai.com/index/introducing-gpt-6-sol-and-luna/ ; https://developer.puter.com/blog/gpt-6-sol-luna-review/ | 2026-09-22 | official (via snippet); pre-image-fix |
| GPT-6 Luna | low | OSWorld 2.0 offline 0808, partial | 8.3% | n/a | https://emergent.sh/learn/gpt-6-luna-benchmarks (host uncertain) | 2026-09-22 | third-party restating OpenAI chart; pre-image-fix |
| GPT-6 Luna | none / medium / high / xhigh | OSWorld 2.0 offline 0808 | not found | not found | (chart not viewable) | n/a | gap |
| GPT-6 Luna | high | AutomationBench | +5.4 pp over GPT-5.6 Luna (absolute n/a) | 58% lower cost/task than GPT-5.6 Luna | https://openai.com/index/introducing-gpt-6-sol-and-luna/ | 2026-09-22 | official (via snippet) |
| GPT-5.6 Sol (older predecessor) | medium | OSWorld 2.0 offline 0808, partial | 49.7% | $2.73/task | https://developer.puter.com/blog/gpt-6-sol-luna-review/ | 2026-09-22 | official comparison point (via snippet) |
| GPT-5.6 Sol (older predecessor) | best / n/s | OSWorld 2.0 offline partial | 65.7% (Astra and 6.1 posts); 66.2% (a Sol/Luna snippet) | ~75 simulated min/task | https://openai.com/index/gpt-6-astra/ ; https://aicatchup.com/news/openai-gpt-6-sol-luna | 2026-09-03 / 09-22 | official (via snippet); conflict |
| GPT-5.6 Sol (older predecessor) | n/s | BrowseComp | 90.4% | n/a | https://www.vellum.ai/blog/gpt-6-astra-benchmarks-explained | 2026-09-03 | official comparison (via snippet) |
| GPT-5.6 Luna (older predecessor) | best / n/s | OSWorld 2.0 offline partial | 52.7% | ~$0.49/task (derived: Luna 6 is "~45% lower" than this) | https://developer.puter.com/blog/gpt-6-sol-luna-review/ | 2026-09-22 | official (via snippet); $ derived estimate |
| Claude Opus 5 (competitor on OpenAI chart) | medium | OSWorld 2.0 offline 0808, partial (OpenAI harness) | 60.3% | $12.67/task | https://aicatchup.com/news/openai-gpt-6-sol-luna | 2026-09-22 | official OpenAI comparison (via snippet) |
| GPT-6 Astra (third-party) | n/s | RecreationWorld (hybrid CUA) | 58.06% | n/a | https://arxiv.org/pdf/2609.22000 | 2026-09 | third-party |
| Claude Opus 5 (third-party) | n/s | OSWorld 2.0 partial, 500 steps (leaderboard) | 70.6% | n/a | https://yutori.com/leaderboards/osworld-2 (host uncertain) | early 2026-09 | third-party; low confidence |
| GPT-6.1 Sol (NOT computer use; do not plot as OSWorld) | max | Terminal-Bench Science 0.1 | 57.0% | $5.47/task (Astra 68.1% at $23.80; Opus 5.5 63.3% at $23.21) | https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task ; https://handyai.substack.com/p/model-drop-gpt-61-sol | 2026-09-29 | official (via snippet); often mislabelled as OSWorld |

Pricing reference (per 1M tokens, standard tier, ≤272K input). Batch and Flex are 0.5×, Fast/priority is 2×, and >272K is 2× input and cache plus 1.5× output:

| model | input | cached input | cache write | output | >272K | source |
|---|---|---|---|---|---|---|
| GPT-6 Astra | $10 | $1 | $12.50 | $50 | $20 in / $75 out | https://www.yottalabs.ai/post/gpt-6-astra-pricing-api-cost-2026 |
| GPT-6.1 Sol | $2 | $0.10 | ~$2.50 (derived 1.25×) | $10 | 2× in and cache / 1.5× out | https://openai.com/index/introducing-gpt-6-1-sol/ ; https://www.developersdigest.tech/blog/gpt-6-1-sol-release-guide-2026 |
| GPT-6 Sol | $2 | $0.20 | ~$2.50 (derived) | $10 | 2× / 1.5× | https://www.ghacks.net/2026/09/23/openai-launches-gpt-6-sol-and-luna-with-50-lower-api-pricing-than-gpt-5-6/ |
| GPT-6 Luna | $0.10 | $0.01 | $0.125 | $0.50 | 2× / 1.5× | https://www.eesel.ai/blog/gpt-6-luna-pricing |
| GPT-5.6 Sol (older) | $4 | n/a | n/a | $20 | n/a | https://www.ghacks.net/2026/09/23/openai-launches-gpt-6-sol-and-luna-with-50-lower-api-pricing-than-gpt-5-6/ |
| GPT-5.6 Luna (older) | $0.20 | n/a | n/a | $1.20 | n/a | https://finance.yahoo.com/technology/ai/articles/openai-cuts-gpt-6-sol-111351382.html |
