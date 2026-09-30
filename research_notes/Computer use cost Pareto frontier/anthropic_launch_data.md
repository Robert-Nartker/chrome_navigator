# Claude Opus 5.5 / Sonnet 5.5: computer-use and browser-use performance vs. effort and cost (Anthropic launch data)

Research date: 2026-09-29. Opus 5.5 launched 2026-09-22; Sonnet 5.5 launched 2026-09-28. Everything about Opus 5, Sonnet 5, Opus 4.8 and Fable is **predecessor data**.

Access notes:
- The anthropic.com launch pages and the platform.claude.com docs were fetched in full.
- The **system card PDFs could not be fetched**. Both system-card links redirect to `www-cdn.anthropic.com`, which the egress proxy blocks. alphaxiv, Zvi's WordPress, vellum.ai, llm-stats-adjacent hosts, snorkel.ai, claudefa.st and orcarouter were also blocked.
- Numbers attributed to the system cards (strict OSWorld scores, harness details) therefore come **only from search-result snippets** and are labelled as such.
- The launch pages render their cost-vs-effort charts from CSV embedded in the page source. I extracted those points **exactly**, so they are official values and not chart-read estimates.

## 1. What computer-use / browser-use scores did Anthropic publish for Opus 5.5 and Sonnet 5.5?

### Takeaway
Anthropic's launch posts give only **one computer-use number per model**, OSWorld 2.1 with partial-credit scoring: Opus 5.5 = 81.8% at max effort and Sonnet 5.5 = 80.1% (effort not stated; probably Max). No browser-use benchmark appears in either post: no BrowseComp, WebArena, Online-Mind2Web, WebVoyager, ScreenSpot or tau-bench. The nearest web task is Perplexity's WANDR, a web data-collection benchmark, which is published only for Opus 5.5 and does come with a full effort-vs-cost curve. Strict (binary) OSWorld 2.1 scores are reportedly in the system cards: about 48.7% for Opus 5.5 and 43.5% for Sonnet 5.5. These come from search snippets only.

### Cited Findings
**Opus 5.5 launch table**
- The row reads "Computer use | OSWorld 2.1 | partial": Opus 5.5 **81.8%**, Fable 5.1 80.7%, Opus 5 74.0%. GPT-6 Astra and GPT-5.6 Sol show "—" (no score) — [Anthropic, Introducing Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- The table footnote says "Unless otherwise noted, all Claude Opus 5.5 results use adaptive thinking at max effort." It also says: "Claude Opus 5.5 was evaluated with its production safeguards enabled. When they intervened, cybersecurity tasks were completed by Claude Opus 4.8, and biology and frontier LLM development tasks were completed by Claude Opus 5." — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- The page claims Opus 5.5 "leads in agentic coding, computer use, and knowledge work." It adds that "In our own use, the gap between Opus 5.5 and Claude Fable 5.1 is narrower than these scores suggest." — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)

**Opus 5.5 WANDR chart (nearest browse-style task)**
- WANDR is Perplexity's benchmark for "large data collection tasks". Its footnote reads: "Claude models were run with offline versions of the web search and web fetch tools, programmatic tool calling, code execution, and a 980k-token task budget. This differs from Perplexity's published setup, scores are not directly comparable". The x-axis is "Cost per attempt (USD, log scale)". — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- Opus 5.5 WANDR points (exact values from the page's embedded CSV):

  | Effort | Score | Cost per attempt |
  |---|---|---|
  | Low | 31.2% | $1.20 |
  | Med | 62.8% | $11.20 |
  | High | 67.3% | $16.88 |
  | Xhigh | 71.3% | $29.06 |
  | Max | 72.3% | $37.92 |

  Fable 5.1: Low 63.3%/$23.25, Med 64.5%/$27.41, High 66.7%/$33.62, Xhigh 67.7%/$42.81, Max 68.7%/$49.02.
  Opus 5: Low 50.5%/$10.65, Med 58.1%/$23.97, High 64.6%/$43.49, Xhigh 67.0%/$53.84, Max 67.2%/$61.62.
  — [Anthropic, Opus 5.5 (page source)](https://www.anthropic.com/claude-opus-5-5)

**Prompt injection (qualitative only)**
- "On prompt injection attacks, it matches or beats Opus 5 in every setting we tested, including coding, tool use, computer use, and web browsing." Gray Swan's benchmark has Opus 5.5 tied with Fable 5.1 for the lowest attack success rate. No numbers are given on the page. — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)

**Sonnet 5.5 launch table**
- The row reads "Computer use | OSWorld 2.1 | partial": Sonnet 5.5 **80.1%**, Sonnet 5 57.0%, Opus 5.5 81.8%, GPT-6 Sol "—" — [Anthropic, Introducing Claude Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)
- The page says Sonnet 5.5 is "close to Opus 5.5 in computer use and chart recognition". It also calls it the "First Sonnet model" to beat Pokémon Red "working only from screenshots". — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)
- The Sonnet 5.5 page has no general "unless otherwise noted" effort footnote. The table points to the [Sonnet 5.5 System Card](https://www.anthropic.com/claude-sonnet-5-5-system-card) "for details on how we run our evaluations". — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)
- Four of Sonnet 5.5's table values match its **Max** points on the page's own effort charts: Terminal-Bench 4.0 70.6%, CursorBench 55.5%, AA-Briefcase 1811, and FrontierCode 46.2% (explicitly flagged "Max"). — [Anthropic, Sonnet 5.5 (page source)](https://www.anthropic.com/claude-sonnet-5-5)

**Strict scores and harness details (search snippets only)**
- Opus 5.5 was reported at "81.8% partial / 48.7% strict on OSWorld". It was "re-run on the September 10, 2026 task files with a harness that keeps every screenshot and compacts server-side past 100k tokens". The originating page could not be opened; one snippet calls the suite "OSWorld 2.0" rather than 2.1. — search snippets via [llm-stats Opus 5.5 launch](https://llm-stats.com/blog/research/claude-opus-5-5-launch) and [Kingy AI](https://kingy.ai/blog/claude-opus-5-5-specs-benchmarks-pricing-comparison/). Both are third-party and both attribute the 48.7% figure to the Opus 5.5 System Card.
- Sonnet 5.5: "The Sonnet 5.5 System Card reports an OSWorld 2.1 strict score of 43.5% alongside the partial score of 80.1%" ("System Card §8"). — search snippets via [Vellum](https://www.vellum.ai/blog/claude-sonnet-5-5-benchmarks-explained) and [llm-stats Sonnet 5.5](https://llm-stats.com/blog/research/claude-sonnet-5-5-launch). The pages themselves were blocked.

**Variant naming conflict (2.0 vs 2.1)**
- Anthropic's own pages say **OSWorld 2.1** (partial).
- Some coverage says "OSWorld 2.0 (partial) places Opus 5.5 at 81.8%" — [llm-stats](https://llm-stats.com/blog/research/claude-opus-5-5-launch) (snippet).
- A third-party chart repo notes that the new 2.1 points are "drawn hollow, on a dashed segment" because "the dip into these points is a change of eval, not a decline". That refers to the switch from OSWorld-Verified to OSWorld 2.1. — [JacobBrooke95/Claude-Model-Guide PR #49](https://github.com/JacobBrooke95/Claude-Model-Guide/pull/49)

**OSWorld 2.0 benchmark definition (third-party, snippet only)**
- Submissions are "scored at 150 / 300 / 500 agent-step budgets". Strict success is "binary completion". The Score metric "provides partial credit averaged across an average of 27.25 scoring checkpoints per task". — [Snorkel AI OSWorld 2.0 leaderboard](https://snorkel.ai/leaderboard/os-world-2-0/) (snippet; page blocked)

### Inferences
- **Opus 5.5 81.8%** can be placed on the chart as "max effort, OSWorld 2.1 partial-credit, pass@1-style mean". Trial count and step budget are unpublished on the launch page.
- **Sonnet 5.5 80.1%** is most likely Max effort, following the pattern of its other table entries. This is an inference and is not stated.
- Partial and strict OSWorld 2.1 scores are not comparable to OSWorld-Verified (Sonnet 5 era) or OSWorld 2.0 (Opus 5 era). Opus 5 scores 74.0% on 2.1 partial but about 70.6% on 2.0 (see §3), so the versions differ in difficulty and scoring.
- The strict/partial gap is about 33 points (Opus 5.5) and about 37 points (Sonnet 5.5). Which variant you plot changes the Pareto picture a lot.
- On WANDR, Opus 5.5 at **Medium** ($11.20) beats Opus 5 at Med ($23.97) and nearly matches Opus 5 at High ($43.49) for about a quarter of the cost. Opus 5.5 at **Low** is extremely cheap ($1.20) but drops sharply (31.2%). This is the only official browse-style effort curve for a 5.5 model.

### Gaps
- No official per-effort OSWorld 2.1 scores, cost per task, tokens per task, step budget, trial count or observation mode (screenshot-only vs. accessibility tree) for either 5.5 model. The system card PDFs, where these would be, were unreachable.
- No BrowseComp, BrowseComp-Plus, Online-Mind2Web, WebArena, WebVoyager, ScreenSpot-Pro, AndroidWorld or tau-bench score for Opus 5.5 or Sonnet 5.5 was found in any accessible source. The Anthropic cookbook on reproducing agentic-search scores defers to the model cards.
- One snippet mentioned BrowseComp-Plus with a fetch tool improving "from 70.48% ... to 85.30%". I could not tie it to the 5.5 system card; it may be from an older card. Excluded.
- No WANDR data for Sonnet 5.5.

## 2. Which effort levels / thinking modes exist, and do any charts show score vs effort or cost?

### Takeaway
Both 5.5 models support low / medium / high / xhigh / max.
- **Opus 5.5:** API default is **medium**. Thinking is **always on** (adaptive) and cannot be disabled.
- **Sonnet 5.5:** API default is **high**; Claude apps and Claude Code default to Medium. The "thinking off" equivalent is the new `thinking: {"type":"between_tools"}` mode, which is allowed only at low, medium and high.
- **Fast mode:** Opus only, at 2× price for up to 2.5× speed. Not offered for Sonnet 5.5.

Neither 5.5 launch post has an OSWorld-vs-effort chart. They do publish exact effort-vs-cost-per-task curves for coding, knowledge-work, business-workflow and web-data-collection benchmarks.

### Cited Findings
**Effort parameter (docs)**
- Levels are `max`, `xhigh`, `high`, `medium` and `low`. `max` and `xhigh` are both listed as available on Opus 5.5 and Sonnet 5.5. — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- "Most Claude models default to high effort ... Claude Opus 5.5 defaults to medium." — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- Level descriptions from the docs:
  - `xhigh`: "Long-running agentic and coding tasks (over 30 minutes) with token budgets in the millions".
  - `medium`: "Agentic tasks that require a balance of speed, cost, and performance".
  - `low`: "Simpler tasks that need the best speed and lowest costs, such as subagents".
  - "Effort is a behavioral signal, not a strict token budget."
  — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- "Lower effort also means fewer and terser tool calls." Lower effort levels "Combine multiple operations into fewer tool calls" and "Make fewer tool calls". — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)

**Opus 5.5 thinking**
- "Adaptive thinking is always on and can't be turned off ... Requests that set `thinking: {"type": "disabled"}` return a 400 error at every effort level." — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- "More thinking per turn at a given effort level. At the same effort setting the model tends to think more per turn than Claude Opus 5, most of all at `xhigh` and `max`." — [What's new in Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)
- Opus 5 accepted `thinking: disabled` "at effort `high` or below". This is predecessor behaviour. — [What's new in Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)

**Sonnet 5.5 thinking and effort**
- "Its levels are recalibrated, so a level doesn't produce the same amount of thinking as the same level on Claude Sonnet 5 ... For agentic coding and multistep tool use, start with `medium` for well-specified tasks and move to `high` for harder or longer ones." — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- "To turn off up-front thinking, send `thinking: {"type": "between_tools"}` ... It's the lowest thinking setting ... works at `low`, `medium`, and `high` effort. At `xhigh` or `max`, a request with it returns a 400 error." `disabled` now returns a 400. — [Effort docs](https://platform.claude.com/docs/en/build-with-claude/effort); [Sonnet 5.5 migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)
- "In Claude Code and our apps, the default effort is set to Medium, while the Claude Platform defaults to High." — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)

**Computer-use effort guidance**
- The computer-use tool docs give effort advice only for older models: Opus 4.7 `high` default; Sonnet 4.6 and Opus 4.6 `medium`, "avoid max". On those 4.6 models, `low` "uses fewer output tokens than disabling thinking entirely". No guidance is given for the 5.5 models. — [Computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) (via fetch summary)

**Fast mode**
- Opus 5.5 fast mode costs $8 input / $40 output per MTok, "with up to 2.5x speed". It is available in Claude Code and on the Claude Platform. — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- Fast mode is a research preview on the Claude API only. It needs `speed: "fast"` and the beta header `fast-mode-2026-02-01`. It is not available on Bedrock, Claude Platform on AWS, Google Cloud or Foundry. Fast-mode pricing "applies across the full context window". Opus 5 and Opus 4.8 fast mode cost $10/$50. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing); [What's new Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5)

**Opus 5.5 effort-vs-cost charts (exact embedded data)**

Format: effort score / cost. Source: [Anthropic, Opus 5.5 (page source)](https://www.anthropic.com/claude-opus-5-5).

| Benchmark (cost axis) | Low | Med | High | Xhigh | Max |
|---|---|---|---|---|---|
| Terminal-Bench 4.0 (cost per attempt) | 38.5% / $1.29 | 57.6% / $2.94 | 64.2% / $3.88 | 66.4% / $7.35 | 64.8% / $11.24 |
| FrontierCode v1.1 main (cost per task) | 47.3% / $0.40 | 54.64% / $0.80 | 53.99% / $1.09 | 51.42% / $2.25 | 54.43% / $6.19 |
| CursorBench 4.0 (cost per task) | 43.7% / $1.18 | 52.5% / $2.90 | 56.0% / $3.97 | 56.0% / $6.99 | 57.8% / $13.43 |
| GDPval-AA v2.1 (Elo; estimated cost per task) | 1224 / $0.21 | 1576 / $0.86 | 1692 / $1.54 | 1820 / $4.21 | 1846 / $8.92 |
| AutomationBench (Zapier; pass rate, cost per task) | 23.3% / $0.50 | 28.6% / $0.64 | 32.0% / $0.70 | 34.4% / $0.86 | 40.0% / $1.37 |
| WANDR (cost per attempt) | see §1 | | | | |

**Sonnet 5.5 effort-vs-cost charts (exact embedded data)**

Source: [Anthropic, Sonnet 5.5 (page source)](https://www.anthropic.com/claude-sonnet-5-5).

| Benchmark (cost axis) | Low | Med | High | Xhigh | Max |
|---|---|---|---|---|---|
| Terminal-Bench 4.0 (cost per attempt) | 20.0% / $0.76 | 28.8% / $0.83 | 43.0% / $1.94 | 61.5% / $5.30 | 70.6% / $12.54 |
| FrontierCode 1.1 main (cost per task) | 29.3% / $0.19 | 36.5% / $0.24 | 49.4% / $0.42 | 52.1% / $1.59 | 46.2% / $20.78 |
| CursorBench 4.0 (cost per task) | 35.8% / $0.50 | 39.2% / $0.70 | 47.8% / $1.67 | 53.1% / $3.88 | 55.5% / $9.67 |
| AA-Briefcase v1.1 (Elo) | 1264 / $0.87 | 1461 / $1.64 | 1634 / $3.95 | 1746 / $9.63 | 1811 / $29.19 |

The Sonnet 5.5 charts also re-plot Opus 5.5 and Sonnet 5. On Terminal-Bench 4.0, Sonnet 5 scored Low 3.2% / $3.78 up to Max 10.3% / $11.62. On FrontierCode, Sonnet 5 scored Low 28.7% / $2.39 up to Max 42.4% / $17.12.

**Predecessor charts**
- The Opus 5 launch post (2026-07-24) has OSWorld 2.0 effort-vs-cost charts. It says: "Opus 5 outperforms every other model at any given cost, surpassing Fable 5's best result at just over a third of the cost." The chart is an image on the blocked CDN, so no data points could be extracted. — [Anthropic, Introducing Claude Opus 5](https://www.anthropic.com/news/claude-opus-5)
- The Sonnet 5 launch post (2026-06-30) has effort-vs-cost curves on **BrowseComp** and **OSWorld-Verified** for Sonnet 5, Sonnet 4.6 and Opus 4.8. Its notes:
  - The charts price Sonnet 5 at $3/$15, so its actual cost is lower than shown.
  - The BrowseComp chart was corrected to the standard methodology: "10M token budget with compaction and programmatic tool calling".
  - The images were not accessible.
  — [Anthropic, Introducing Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)

### Inferences
Cost multipliers relative to **High** effort, computed from the official curves above:

| Model / benchmark | Low | Med | High | Xhigh | Max |
|---|---|---|---|---|---|
| Opus 5.5, Terminal-Bench 4.0 | 0.33× | 0.76× | 1× | 1.89× | 2.90× |
| Opus 5.5, CursorBench 4.0 | 0.30× | 0.73× | 1× | 1.76× | 3.38× |
| Opus 5.5, GDPval-AA v2.1 | 0.14× | 0.56× | 1× | 2.73× | 5.78× |
| Opus 5.5, WANDR | 0.07× | 0.66× | 1× | 1.72× | 2.25× |
| Opus 5.5, AutomationBench | 0.71× | 0.91× | 1× | 1.23× | 1.96× |
| Sonnet 5.5, Terminal-Bench 4.0 | 0.39× | 0.43× | 1× | 2.73× | 6.46× |
| Sonnet 5.5, CursorBench 4.0 | 0.30× | 0.42× | 1× | 2.32× | 5.79× |
| Sonnet 5.5, AA-Briefcase v1.1 | 0.22× | 0.42× | 1× | 2.44× | 7.38× |

Sonnet 5.5 FrontierCode Max is an outlier at about 50× High, caused by code-review subagent timeouts. This gives a defensible **proxy band** for how OSWorld cost might scale with effort: Low ≈ 0.1–0.4× High, Medium ≈ 0.4–0.75×, Xhigh ≈ 1.7–2.7×, Max ≈ 2–7×. Treat it as an assumption until official computer-use sweeps exist.

- For Sonnet 5.5, Low and Medium cost nearly the same on Terminal-Bench ($0.76 vs $0.83). The big jumps come at High and above.
- For Opus 5.5 the largest step is Low→Medium on WANDR: 10× the cost for +31.6 points.
- Scores plateau or dip at Max on several benchmarks: Opus 5.5 Terminal-Bench (Max < Xhigh), FrontierCode (High ≈ Max), and Sonnet 5.5 FrontierCode (Max < Xhigh). On a computer-use Pareto chart, Xhigh and Max may therefore be dominated points.
- The Opus 5.5 OSWorld point (max effort) sits at the **most expensive** end of Opus 5.5's curve. By analogy with the charts above, Opus 5.5 at max probably costs about 2–6× its default (medium) cost. This is unconfirmed.

### Gaps
- No OSWorld (any version) or browse-benchmark effort sweep for Opus 5.5 or Sonnet 5.5 was found.
- No published OSWorld number for Sonnet 5.5 in `between_tools` (thinking-off) mode.
- No published computer-use number for Opus 5.5 in fast mode. Fast mode should change latency and $/token only, not accuracy, but this is not stated for computer use.
- The Opus 5 OSWorld 2.0 and Sonnet 5 OSWorld-Verified/BrowseComp chart data points exist only as images on the blocked CDN.

## 3. Predecessor scores on the same or related benchmarks (anchors)

### Takeaway
Three different OSWorld variants appear across recent launches, so anchor with care:

| Variant | Used for | Example scores |
|---|---|---|
| OSWorld-Verified | Sonnet 5, Opus 4.8 era | Sonnet 5 ≈ 81.2% (third-party) |
| OSWorld 2.0 | Opus 5 era | Opus 5 ≈ 70.6%, Fable 5 ≈ 66.1% (third-party) |
| OSWorld 2.1 partial | 5.5 era | Opus 5 74.0%, Sonnet 5 57.0%, Fable 5.1 80.7% (official, re-run by Anthropic) |

### Cited Findings
**OSWorld 2.1 partial (official, 5.5 tables)**
- Opus 5: 74.0%. Fable 5.1: 80.7% (both max effort per the table footnote, which covers the Claude models). — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- Sonnet 5: 57.0% (effort not stated). — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)

**OSWorld 2.0 (Opus 5 era, third-party snippets)**
- "On OSWorld 2.0, the computer-use benchmark, Opus 5 (70.6%) replaces Fable 5 (66.1%) as the overall leading model." Also: "Opus 5 hits 70.5 at roughly $25 per task while Fable 5 reaches only 66.1 at roughly $47." — search snippets from [DataCamp Opus 5 vs Fable 5](https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5), [claudefa.st](https://claudefa.st/blog/models/claude-opus-5-vs-fable-5) and [Developers Digest](https://www.developersdigest.tech/blog/claude-opus-5-vs-opus-4-8-vs-fable-5-comparison-2026). The exact originating page among these is unclear; the numbers are presumably read off Anthropic's Opus 5 chart.
- Anthropic's own wording for the same chart: Opus 5 surpasses "Fable 5's best result at just over a third of the cost". — [Anthropic, Opus 5](https://www.anthropic.com/news/claude-opus-5)

**OSWorld-Verified and BrowseComp (Sonnet 5 / Opus 4.x era)**
- Sonnet 5 OSWorld-Verified is **81.2%**, "2.2 points behind Opus 4.8 and 2.7 points ahead of Sonnet 4.6". That implies Opus 4.8 ≈ 83.4% and Sonnet 4.6 ≈ 78.5%. — search snippet via [Vellum Sonnet 5](https://www.vellum.ai/blog/claude-sonnet-5-benchmarks-explained) / [buildfastwithai](https://www.buildfastwithai.com/blogs/claude-sonnet-5-review-benchmarks-pricing-2026)
- Sonnet 5 BrowseComp is **84.7%** (snippet). "At x-high effort, Sonnet 5 performs roughly in line with Opus 4.8 at medium-to-high effort on both benchmarks." This is third-party reading of the chart. — [Vellum Sonnet 5](https://www.vellum.ai/blog/claude-sonnet-5-benchmarks-explained) (snippet)
- Anthropic re-ran OSWorld-Verified with a changed methodology:
  - Sonnet 4.6 was updated to **78.5%** — [Anthropic, Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)
  - Opus 4.7 was updated to **82.3%** — [Anthropic, Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8)
- Opus 5 BrowseComp is **90.8%** — search snippet from aggregator pages ([BenchmarkList](https://benchmarklist.com/models/anthropic-claude-opus-5/) / [AIToolsReview](https://aitoolsreview.co.uk/insights/claude-opus-5)). Not verified against the Opus 5 system card.

**Online-Mind2Web**
- An early-tester quote on the Opus 4.8 launch page says: "Claude Opus 4.8 is the strongest computer-use and browser-agent model we've tested, scoring 84% on Online-Mind2Web". This is a customer's own eval, not Anthropic's. — [Anthropic, Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8)

**Launch dates**

| Model | Launch date | Source |
|---|---|---|
| Opus 4.8 | 2026-05-28 | [Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8) |
| Fable 5 | 2026-06-09 | search snippet |
| Sonnet 5 | 2026-06-30 | [Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5) |
| Opus 5 | 2026-07-24 | [Opus 5](https://www.anthropic.com/news/claude-opus-5) |
| Opus 5.5 | 2026-09-22 | [Opus 5.5](https://www.anthropic.com/claude-opus-5-5) |
| Sonnet 5.5 | 2026-09-28 | [Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5) |

### Inferences
- Because Anthropic re-ran Opus 5 on OSWorld 2.1 partial (74.0%) and Sonnet 5 (57.0%), the like-for-like 5.5 generational gains are: **Opus +7.8 points** (74.0→81.8) and **Sonnet +23.1 points** (57.0→80.1).
- Do not chain OSWorld-Verified numbers (about 78–83%) to OSWorld 2.1 partial numbers. Sonnet 5 reads 81.2% on Verified but 57.0% on 2.1 partial.
- Opus 5 cost about $25 per task on OSWorld 2.0, from a third-party chart reading at an unknown effort level. Opus 5.5 is 20% cheaper per token and uses fewer tokens. If Anthropic's "40% cheaper on typical workloads" held for OSWorld, Opus 5.5 would land at roughly $15 per task. This is a speculative anchor, not a published value.

### Gaps
- No official per-effort OSWorld 2.0 data for Opus 5, and no OSWorld-Verified or BrowseComp data for Sonnet 5 (images blocked).
- The Fable 5.1 and Opus 5 OSWorld 2.1 strict scores were not found.
- Opus 4.8 official OSWorld-Verified: only the implied ≈83.4% (from the snippet arithmetic) was available.

## 4. Official API pricing, fast mode, long context, and screenshot billing

### Takeaway
**Opus 5.5** prices (per MTok):

| Item | Price |
|---|---|
| Input | $4 |
| 5-minute cache write | $5 |
| 1-hour cache write | $8 |
| Cache read | $0.20 (0.05× input) |
| Output | $20 |
| Fast mode input / output | $8 / $40 |

**Sonnet 5.5** prices (per MTok):

| Item | Price |
|---|---|
| Input | $2 |
| 5-minute cache write | $2.50 |
| 1-hour cache write | $4 |
| Cache read | $0.20 |
| Output | $10 |
| Fast mode | none |

- There is no long-context surcharge: the 1M context window is billed at standard rates.
- Batch is 50% off. US-only inference is 1.1×.
- Screenshots are billed as image input at ⌈w/28⌉×⌈h/28⌉ tokens. The 5.5 models are on the "high-resolution" tier (up to 2576 px long edge / 4784 tokens), so a 1280×720 screenshot is 1,196 tokens and a 1920×1080 screenshot is 2,691 tokens.

### Cited Findings
**Model pricing**
- Pricing table rows:
  - "Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok² | $20 / MTok"
  - "Claude Sonnet 5.5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok"
  - Opus 5: $5 / $6.25 / $10 / $0.50 / $25. Sonnet 5: $2 / $2.50 / $4 / $0.20 / $10. Fable 5.1: $10 / $12.50 / $20 / $0.25 / $50.
  - Footnote: "Cache hits and refreshes on Claude Opus 5.5 are priced at 0.05x the base input price."
  — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Sonnet 5's introductory $2/$10 became the permanent price, and the planned $3/$15 increase was cancelled. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing); [Anthropic, Sonnet 5 changelog](https://www.anthropic.com/news/claude-sonnet-5)

**Launch-page pricing claims**
- Opus 5.5 is "20% less than Opus 5" per token. Cache reads are "60% less". "At default settings it will cost 40% less than Opus 5 on typical workloads." It "generates output more than 30% faster". — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- Sonnet 5.5 "is priced the same as Sonnet 5 ... it costs up to 30% less per task than its predecessor" and is "30%+ faster". — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)

**Other pricing modifiers**
- Fast mode: Opus 5.5 $8/$40. Opus 5 and 4.8 $10/$50. Prompt-caching and data-residency multipliers stack on top. Fast mode cannot be combined with Batch. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Long context: "Claude 4.6 and later models ... include the full 1M token context window at standard pricing. (A 900k-token request is billed at the same per-token rate as a 9k-token request.)" — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch: Opus 5.5 $2/$10 and Sonnet 5.5 $1/$5. Data residency: `inference_geo: "us"` costs 1.1×. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Tokenizer: "Claude 4.7 and later models ... use a newer tokenizer ... approximately 30% more tokens for the same text." Sonnet 5's tokenizer produces "roughly 1.0–1.35×" more tokens than Sonnet 4.6. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing); [Anthropic, Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5)

**Tool overhead**
- Tool-use system prompt: 286 tokens for Opus 5.5 and Sonnet 5.5 (auto/none). — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Computer-use toolset: "Declaring `computer_toolset_20260801` with its default members adds about 4,500 input tokens to a request". Disabling `zoom` removes about 410 of those. Screenshot and zoom images are "billed as image input". — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Browser-use toolset: "Declaring `browser_toolset_20260801` with its default members adds about 6,600 input tokens". Enabling all four optional members adds about 880. Accessibility trees, page text and console output count as text tool results. — [Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- The 5.5 models accept computer use **only** via `computer_toolset_20260801` on the Claude API and Google Cloud; `computer_20251124` returns a 400. — [What's new Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5); [Computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

**Image token formula and sizes**
- "An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens." Resolution tiers: High-resolution "Claude 4.7 and later models | 2576 px | 4784" max tokens; Standard "1568 px | 1568". — [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Official example: 1920×1080 → "Not resized | 2691" tokens on the high-resolution tier (1,560 on standard). Also: "High-resolution images can use up to roughly three times more visual tokens". — [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Oversized computer-use and browser-use screenshots are **rejected, not downscaled**: "resize those images in your application before returning them". Above 20 images per request, a stricter per-image limit applies; the docs advise keeping each side ≤2000 px or ≤20 images. — [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

**Computer-use tool page guidance (via fetch summary)**
- Recommended resolutions are 1024×768 or 1280×720 for desktop and 1280×800 or 1366×768 for web; "avoid resolutions above 1920x1080".
- "Screenshots cost roughly 1,000–1,800 input tokens each."
- Suggested pruning: "keep the last three screenshots and prune every 25 turns".

— [Computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

### Inferences
Per-screenshot cost on the 5.5 models, computed from the official formula and prices (my arithmetic):

| Resolution | Tokens | Opus 5.5 uncached | Opus 5.5 5-min cache write | Sonnet 5.5 uncached | Cache read (either model) |
|---|---|---|---|---|---|
| 1024×768 | 1,036 | $0.0041 | — | $0.0021 | $0.00021 |
| 1280×720 | 1,196 | $0.0048 | $0.0060 | $0.0024 | $0.00024 |
| 1280×800 | 1,334 | $0.0053 | — | $0.0027 | — |
| 1366×768 | 1,372 | $0.0055 | — | $0.0027 | — |
| 1920×1080 | 2,691 | $0.0108 | — | $0.0054 | $0.00054 |

- Opus 5.5 and Sonnet 5.5 have the **same cache-read price** ($0.20/MTok). For long, cache-heavy computer-use loops the Opus premium therefore comes mostly from output and thinking tokens ($20 vs $10) and uncached input or cache writes ($4 vs $2). Anthropic notes cache reads "make up the majority of agentic and coding work costs".
- Fast mode doubles only the Opus base input and output rates. Cache multipliers apply on top, so fast-mode cache reads would be about $0.40/MTok. That figure is inferred from "multipliers apply on top of fast mode pricing" and is not explicitly listed.

### Gaps
- No documented per-screenshot token figure specific to 5.5, beyond the generic formula and the "1,000–1,800 tokens" guidance.
- The exact computer-toolset overhead for 5.5 models is given as "about 4,500". The docs list separate figures only for Fable 5, Mythos 5, Opus 5, Opus 4.8 (≈4,520) and Sonnet 5 (≈4,590).

## 5. Anthropic-reported tokens or cost per task for computer use, and how effort changes token usage

### Takeaway
Anthropic published **no tokens-per-task or $-per-task figure for any computer-use eval** of Opus 5.5 or Sonnet 5.5. The closest official agentic cost-per-task data are the exact effort curves in §1–2 (WANDR, Terminal-Bench, CursorBench and others) and the docs' SWE-bench Pro effort sweep. Qualitatively, Anthropic and early testers say the 5.5 models use markedly fewer tokens, steps and tool calls than the 5.0 models.

### Cited Findings
**Anthropic statements**
- "It costs less per token than Opus 5 and uses fewer tokens per task, which nets out to a 40% drop in costs." — [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
- "Sonnet 5.5 requires fewer tokens per task than Sonnet 5 ... in head-to-head runs, it batched tool calls together more than Sonnet 5, leading to fewer steps and lower costs." Also: "On several benchmarks, Sonnet 5.5 at Low or Medium effort beats Sonnet 5's best score for about a tenth of the cost per task." — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)
- "As effort goes up, models typically work for longer, leading to a higher cost per task but generally also a higher score." — [Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)

**Docs effort sweep (SWE-bench Pro, Opus 5.5)**

| Effort | Accuracy | Cost per task |
|---|---|---|
| Low | 87.4% | $0.11 |
| Medium | 90.3% | $0.16 |
| High | 92.8% | $0.23 |

- Low is "62% of high cost" and medium "70% of high cost" (as quoted by the fetch summary).
- Re-running failures at high after a low-effort pass gives "~97% pass rate, ~$0.17 per task".
- Caveat: the same summary elsewhere listed "Opus 5.5 at medium (default) 92.8% ... ~$0.22 per solved task". The summarizer may have garbled the rows; verify on the page before use.
- Also reported: Chartography "Claude Opus 5.5 at `low`: 68.7 score, ~$0.03/chart".

— [Optimizing for cost and intelligence (docs)](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence)

**Early-tester statements (customer claims, not Anthropic evals)**

Opus 5.5 ([Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)):
- Box: "Claude Opus 5.5 used a third of the tokens Opus 5 did".
- Kiro: "solved more than Opus 5 while making about 40% fewer calls and using half the tokens".
- Lovable: "a third to half fewer steps".
- Another tester (unnamed on the page): Opus 5.5 at medium "matched Opus 5 on high effort, while using 20 to 25% fewer output tokens".
- Another tester (unnamed on the page): at the lowest effort, Opus 5.5 "beat Opus 5 at high effort ... with about 60% fewer output tokens".

Sonnet 5.5 ([Anthropic, Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)):
- A finance tester: Sonnet 5.5 "used about 121k tokens per answer, where Sonnet 5 used 497k".
- Slack: "about 14% fewer output tokens".
- Another tester: "a third fewer tool calls and roughly half the shell runs".

**Harness configurations**
- Anthropic's agentic-search reproduction cookbook (shown for Sonnet 5) uses effort `max`, a 3,000,000-token `task_budget`, compaction at 200k tokens, and code execution + web_search + web_fetch with programmatic tool calling. It publishes no model scores. — [Claude Cookbook: reproduce agentic search benchmarks](https://platform.claude.com/cookbook/evals-agentic-search-reproduce-agentic-search-benchmarks)
- For comparison, the Sonnet 5 BrowseComp chart used a "10M token budget with compaction and programmatic tool calling". The Opus 5.5 WANDR runs used a "980k-token task budget". — [Anthropic, Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5); [Anthropic, Opus 5.5](https://www.anthropic.com/claude-opus-5-5)

### Inferences
- To place the 5.5 models on a computer-use cost axis, you would have to (a) estimate cost per OSWorld task from your own runs, or (b) scale a predecessor anchor. For (b), take the third-party Opus 5 OSWorld 2.0 figure of about $25 per task and apply the "40% cheaper" and "up to 30% cheaper per task" claims. Both approaches are estimates.
- Official launch data supports treating **Medium** as the likely knee of the Opus 5.5 curve on agentic tasks. It is also the Opus default, and Anthropic emphasises "default effort beats predecessor max at ~1/5 cost" on several charts. For Sonnet 5.5 the knee is less clear: High and Xhigh give large score gains on Terminal-Bench and CursorBench.

### Gaps
- No Anthropic tokens-per-task or $-per-task figures for OSWorld 2.1, OSWorld-Verified, BrowseComp or any GUI benchmark for the 5.5 models. There are also no average steps per OSWorld task.
- No statement quantifying how effort changes screenshot count or step count in computer use specifically.

### Consolidated data table

All scores are pass rate / score unless noted. "Official" means from an Anthropic page or docs; "official (embedded chart data)" means exact values from the CSV behind Anthropic's charts; "third-party" and "snippet" mean coverage or search-result snippets that I could not open.

| model | effort/thinking setting | benchmark (exact variant + step budget) | score | tokens or $ per task if given | source URL | date | confidence |
|---|---|---|---|---|---|---|---|
| Opus 5.5 | max effort, adaptive thinking (always on) | OSWorld 2.1, partial-credit scoring; step budget/trials not stated | 81.8% | — | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official |
| Opus 5.5 | not stated in snippet (system card) | OSWorld 2.1 (one snippet says 2.0), strict/binary success; harness keeps all screenshots, server-side compaction past 100k tokens, Sep-10-2026 task files | 48.7% | — | https://llm-stats.com/blog/research/claude-opus-5-5-launch (snippet; attributed to Opus 5.5 System Card) | 2026-09 | third-party snippet |
| Sonnet 5.5 | not stated (likely Max by analogy with other table rows) | OSWorld 2.1, partial-credit scoring | 80.1% | — | https://www.anthropic.com/claude-sonnet-5-5 | 2026-09-28 | official (effort = inference) |
| Sonnet 5.5 | not stated (system card §8) | OSWorld 2.1, strict | 43.5% | — | https://www.vellum.ai/blog/claude-sonnet-5-5-benchmarks-explained (snippet; attributed to Sonnet 5.5 System Card) | 2026-09-28 | third-party snippet |
| Fable 5.1 | max effort | OSWorld 2.1, partial | 80.7% | — | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (reference model) |
| Opus 5 (predecessor) | max effort (per Opus 5.5 table footnote) | OSWorld 2.1, partial | 74.0% | — | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official |
| Sonnet 5 (predecessor) | not stated | OSWorld 2.1, partial | 57.0% | — | https://www.anthropic.com/claude-sonnet-5-5 | 2026-09-28 | official |
| Opus 5 (predecessor) | unknown (read from Anthropic effort chart) | OSWorld 2.0 (partial score presumed; step budget unknown) | 70.6% (also quoted 70.5) | ~$25/task | https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5 (snippet) | 2026-07 | third-party chart-read |
| Fable 5 (predecessor) | best/max point on chart | OSWorld 2.0 | 66.1% | ~$47/task | https://www.datacamp.com/blog/claude-opus-5-vs-claude-fable-5 (snippet) | 2026-07 | third-party chart-read |
| Sonnet 5 (predecessor) | headline (effort not stated) | OSWorld-Verified (Anthropic's revised methodology) | 81.2% | — | https://www.vellum.ai/blog/claude-sonnet-5-benchmarks-explained (snippet) | 2026-06-30 | third-party snippet |
| Opus 4.8 (predecessor) | headline | OSWorld-Verified | ≈83.4% (implied: Sonnet 5 + 2.2) | — | https://www.vellum.ai/blog/claude-sonnet-5-benchmarks-explained (snippet) | 2026-06 | third-party, derived |
| Sonnet 4.6 (predecessor) | headline | OSWorld-Verified (re-run, revised methodology) | 78.5% | — | https://www.anthropic.com/news/claude-sonnet-5 | 2026-06-30 | official |
| Opus 4.7 (predecessor) | headline | OSWorld-Verified (re-run, revised methodology) | 82.3% | — | https://www.anthropic.com/news/claude-opus-4-8 | 2026-05-28 | official |
| Sonnet 5 (predecessor) | headline | BrowseComp (10M-token budget, compaction, programmatic tool calling) | 84.7% | — | https://www.vellum.ai/blog/claude-sonnet-5-benchmarks-explained (snippet) | 2026-06-30 | third-party snippet |
| Opus 5 (predecessor) | headline | BrowseComp | 90.8% | — | https://benchmarklist.com/models/anthropic-claude-opus-5/ (snippet) | 2026-07/08 | third-party snippet |
| Opus 4.8 (predecessor) | unknown | Online-Mind2Web (customer's own run) | 84% | — | https://www.anthropic.com/news/claude-opus-4-8 | 2026-05-28 | official page, customer quote |
| Opus 5.5 | Low | WANDR (Perplexity web data collection; offline web search/fetch, PTC, code exec, 980k-token task budget) | 31.2% | $1.20/attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | Medium (default) | WANDR (same setup) | 62.8% | $11.20/attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | High | WANDR | 67.3% | $16.88/attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | Xhigh | WANDR | 71.3% | $29.06/attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | Max | WANDR | 72.3% | $37.92/attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Fable 5.1 | Low / Med / High / Xhigh / Max | WANDR | 63.3 / 64.5 / 66.7 / 67.7 / 68.7% | $23.25 / $27.41 / $33.62 / $42.81 / $49.02 per attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5 (predecessor) | Low / Med / High / Xhigh / Max | WANDR | 50.5 / 58.1 / 64.6 / 67.0 / 67.2% | $10.65 / $23.97 / $43.49 / $53.84 / $61.62 per attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | Low / Med / High / Xhigh / Max | AutomationBench (Zapier; multi-app business workflows via tools, no fallback models) | 23.3 / 28.6 / 32.0 / 34.4 / 40.0% | $0.50 / $0.64 / $0.70 / $0.86 / $1.37 per task | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5 (predecessor) | Low / Med / High / Xhigh / Max | AutomationBench | 20.4 / 23.9 / 20.6 / 25.3 / 26.9% | $0.75 / $0.89 / $1.03 / $1.15 / $1.27 per task | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Opus 5.5 | Low / Med / High / Xhigh / Max | Terminal-Bench 4.0 (agentic CLI; effort-scaling proxy) | 38.5 / 57.6 / 64.2 / 66.4 / 64.8% | $1.29 / $2.94 / $3.88 / $7.35 / $11.24 per attempt | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Sonnet 5.5 | Low / Med / High / Xhigh / Max | Terminal-Bench 4.0 (effort-scaling proxy) | 20.0 / 28.8 / 43.0 / 61.5 / 70.6% | $0.76 / $0.83 / $1.94 / $5.30 / $12.54 per attempt | https://www.anthropic.com/claude-sonnet-5-5 | 2026-09-28 | official (embedded chart data) |
| Opus 5.5 | Low / Med / High / Xhigh / Max | CursorBench 4.0 (effort-scaling proxy) | 43.7 / 52.5 / 56.0 / 56.0 / 57.8% | $1.18 / $2.90 / $3.97 / $6.99 / $13.43 per task | https://www.anthropic.com/claude-opus-5-5 | 2026-09-22 | official (embedded chart data) |
| Sonnet 5.5 | Low / Med / High / Xhigh / Max | CursorBench 4.0 (effort-scaling proxy) | 35.8 / 39.2 / 47.8 / 53.1 / 55.5% | $0.50 / $0.70 / $1.67 / $3.88 / $9.67 per task | https://www.anthropic.com/claude-sonnet-5-5 | 2026-09-28 | official (embedded chart data) |
| Opus 5.5 | Low / Med / High | SWE-bench Pro (docs effort sweep; coding proxy) | 87.4 / 90.3 / 92.8% | $0.11 / $0.16 / $0.23 per task | https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence | 2026-09 | official (via fetch summary; verify) |
| Opus 5.5 | pricing | API list price | — | $4 in / $5 5m-write / $8 1h-write / $0.20 cache read / $20 out per MTok; fast $8/$40; batch $2/$10; no long-context surcharge (1M ctx) | https://platform.claude.com/docs/en/about-claude/pricing | 2026-09 | official |
| Sonnet 5.5 | pricing | API list price | — | $2 in / $2.50 5m-write / $4 1h-write / $0.20 cache read / $10 out per MTok; no fast mode; batch $1/$5 | https://platform.claude.com/docs/en/about-claude/pricing | 2026-09 | official |
| Opus 5.5 / Sonnet 5.5 | screenshot billing | image tokens = ⌈w/28⌉×⌈h/28⌉, high-res tier (≤2576 px, ≤4784 tokens) | — | 1280×720 = 1,196 tokens ($0.0048 Opus / $0.0024 Sonnet uncached; $0.00024 cache read); 1920×1080 = 2,691 tokens ($0.0108 / $0.0054); computer toolset overhead ≈4,500 tokens per request, browser toolset ≈6,600 | https://platform.claude.com/docs/en/build-with-claude/vision ; https://platform.claude.com/docs/en/about-claude/pricing | 2026-09 | official formula; $ = my calculation |
