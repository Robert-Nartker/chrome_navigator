# Cost per task of computer-use / browser-use agents: Claude Opus 5.5, Claude Sonnet 5.5, GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna, by reasoning effort

Research date: 2026-09-29. Access notes: platform.claude.com (Anthropic docs) could be fetched in full. openai.com, developers.openai.com, artificialanalysis.ai, x.com, openrouter.ai, kingy.ai, claude.dev, getnadir.com and aipricing.guru were all blocked by this machine's egress policy. **Every OpenAI and Artificial Analysis (AA) figure below comes from web-search result snippets, not fetched pages.** These are marked "(snippet)". Snippets are short summaries of the pages and may be paraphrased or mis-attributed. Treat them as good but unverified.

## Q1. Current API prices per million tokens (input, cache read, cache write, output), plus fast/priority, batch/flex and long-context modifiers

### Takeaway
All five base prices in the codebase are right. Anthropic's are confirmed on its own pricing page. OpenAI's are confirmed by many secondary sources that agree with each other. The one likely error is the OpenAI **cache-write** rate. `src/lib/models.ts` bills OpenAI cache writes at 1.0x input. Several sources report that GPT-5.6 and later models bill cache writes at **1.25x** input: GPT-6.1 Sol $2.50, GPT-6 Astra $12.50, GPT-6 Luna $0.125. The codebase also leaves out Anthropic's 1-hour cache-write rates (Opus 5.5 $8, Sonnet 5.5 $4) and all premium tiers. Opus 5.5 fast mode is confirmed at exactly 2x ($8/$40). OpenAI Fast is 2x and Ultrafast is 6x.

### Cited Findings
**Anthropic (primary source, fetched)**
- Claude Opus 5.5: $4/MTok base input, $5 for 5-minute cache writes, $8 for 1-hour cache writes, $0.20 for cache hits and refreshes, $20 output. Cache hits on Opus 5.5 cost 0.05x the base input price, unlike the standard 0.1x. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude Sonnet 5.5: $2 input, $2.50 for 5-minute cache writes, $4 for 1-hour cache writes, $0.20 cache hits, $10 output. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Sonnet 5's $2/$10 launch pricing is now standard. The planned rise to $3/$15 on 2026-09-01 "will not occur". — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Cache multipliers: 5-minute write = 1.25x input, 1-hour write = 2x input, read = 0.1x (0.05x on Opus 5.5). The multipliers stack with batch and data-residency pricing. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Fast mode (research preview, first-party API only): Opus 5.5 is $8 input / $40 output, which is 2x. Caching multipliers apply on top. Fast mode can't be combined with Batch. It applies across the full context window. Only Opus models are listed; Sonnet 5.5 has no fast mode. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API is 50% off: Opus 5.5 $2/$10, Sonnet 5.5 $1/$5. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Long context: "Claude 4.6 and later models … include the full 1M token context window at standard pricing". There is no long-context surcharge for Opus 5.5 or Sonnet 5.5. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- US-only inference (`inference_geo: "us"`) multiplies every token category by 1.1x. Bedrock and Vertex regional endpoints carry a 10% premium. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude 4.7 and later models use a newer tokenizer that "produces approximately 30% more tokens for the same text". This matters when comparing text-token counts across vendors. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Toolset overhead per request: `computer_toolset_20260801` adds about 4,500 input tokens. `browser_toolset_20260801` adds about 6,600, plus about 880 more if all optional members are enabled. The tool-use system prompt on Opus 5.5 and Sonnet 5.5 is 286 tokens. Claude Managed Agents adds $0.08 per session-hour of runtime. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Third-party confirmation: "Claude Opus 5.5 costs $4 per million input tokens and $20 per million output tokens … 20% under Opus 5's $5 and $25 … cache reads drop to $0.20" (snippet). — [BazaarLink](https://bazaarlink.ai/en/blog/claude-opus-5-5-api-pricing-en); [Justin McKelvey](https://justinmckelvey.com/blog/claude-opus-5-5)

**OpenAI (search snippets only; openai.com and developers.openai.com are blocked)**
- GPT-6.1 Sol: $2 input, $0.10 cached input, $10 output. Cached input is "95% less than standard input pricing and 50% less than GPT-6 Sol's cached input" (snippet). — [Developers Digest](https://www.developersdigest.tech/blog/gpt-6-1-sol-release-guide-2026); [BenchLM](https://benchlm.ai/models/gpt-6-1-sol)
- AA says GPT-6.1 Sol "Pricing matches GPT-6 Sol at $2/$10 … except that the cache read discount rises" (snippet of an X post title). — [Artificial Analysis on X](https://x.com/ArtificialAnlys/status/2105025585332605357)
- GPT-6.1 Sol modifiers (snippet; the search summary did not tie these to one page):
  - Cache writes are $2.50.
  - "Above 272K input tokens the rates rise to 2x input/cache and 1.5x output" for the full request.
  - "Batch and Flex are 50% off."
  - Search results: [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-1-sol-pricing-benchmarks-upgrade-guide), [Developers Digest](https://www.developersdigest.tech/blog/gpt-6-1-sol-release-guide-2026), [The Rundown](https://www.therundown.ai/tools/gpt-6-1-sol)
- GPT-6 Astra: $10 input, $50 output, cached input $1, cache writes $12.50. "Batch and Flex run at half of standard rates, and Fast mode runs at double" (snippet). — [Yotta Labs](https://www.yottalabs.ai/post/gpt-6-astra-pricing-api-cost-2026); [eesel AI](https://www.eesel.ai/blog/gpt-6-astra-pricing); [CloudZero](https://www.cloudzero.com/blog/gpt-6-pricing/)
- GPT-6 Luna: $0.10 input, $0.50 output, cache read $0.01, cache write $0.125 (snippet). — [Tabbit](https://go.tabbit.ai/blog/gpt-luna-6-pricing); [Layer3 Labs](https://www.layer3labs.io/guides/gpt-6-luna-pricing); [VentureBeat](https://venturebeat.com/technology/openai-releases-gpt-6-sol-and-luna-models-slashing-api-costs-50-or-more)
- "Cache writes on GPT-5.6 and later bill at 1.25x the input rate" (snippet). — [CloudZero](https://www.cloudzero.com/blog/openai-pricing/); consistent with [TrueFoundry](https://www.truefoundry.com/blog/gpt-6-astra)
- Fast mode costs 2x Standard. Ultrafast costs "three times as much as Fast mode and six times as much as Standard", and reaches up to 300 generated tokens/s (snippet). — [VentureBeat](https://venturebeat.com/technology/openais-gpt-6-1-sol-offers-astra-like-performance-at-1-5th-price-a-new-ultrafast-tier-clocks-at-300-tokens-per-second)
- Ultrafast availability: GA for GPT-6 Astra, preview for GPT-5.6 Sol, and GPT-6.1 Sol Ultrafast "in the coming days" (snippet of a GitHub issue). — [senpi issue #2399](https://github.com/code-yeongyu/senpi/issues/2399)
- Aggregator error to avoid: one snippet said GPT-6 Sol's $2/$10 was "matching the pricing tier of Claude Opus 5.5". That is wrong; Opus 5.5 is $4/$20. — [search result set incl. alphacorp.ai](https://alphacorp.ai/blog/claude-sonnet-5-5-vs-gpt-6-sol-benchmarks-pricing-and-which-is-better)

### Inferences
- Codebase check (`src/lib/models.ts`):
  - Opus 5.5 and Sonnet 5.5 are correct, using 5-minute cache writes.
  - GPT-6.1 Sol, Astra and Luna input, cached and output prices are correct.
  - `cacheWrite` for Sol, Astra and Luna should probably be 2.50, 12.50 and 0.125, not 2, 10 and 0.1.
  - In the model below, the 1.25x write premium adds about 10% to a typical OpenAI task (Sol medium: $0.185 vs $0.206).
- Premium modes as multipliers on the base cost per task:
  - Opus 5.5 fast: 2.0x.
  - OpenAI Fast: 2.0x.
  - OpenAI Ultrafast: 6.0x (Astra now; Sol 6.1 soon).
  - Batch/Flex: 0.5x, but async batch is not usable for interactive agent loops. Flex may be usable if latency is tolerable.
- The long-context surcharge (OpenAI, >272K input tokens in one request) is unlikely on a typical task. The per-request context peaks near 40K tokens in the mid scenario and 186K in the high scenario. Long unpruned sessions can cross 272K, and then the whole request is billed at 2x/1.5x.

### Gaps
- OpenAI's own pricing page could not be fetched. The $2.50, $12.50 and $0.125 cache-write rates and the 272K long-context rule rest on secondary snippets. It is also unconfirmed whether the 272K surcharge applies to Astra and Luna.
- No confirmed OpenAI "Priority" price separate from "Fast". Snippets say Fast was "formerly called Priority processing".
- No Sonnet 5.5 fast mode exists in Anthropic's pricing table.

## Q2. Reasoning-effort levels supported

### Takeaway
Both Claude 5.5 models support all five `output_config.effort` levels: low, medium, high, xhigh and max. Opus 5.5 defaults to **medium**, and its thinking is always on. Sonnet 5.5 defaults to **high**. Sonnet's "thinking-off" mode is `thinking: {"type": "between_tools"}`, which works only at low, medium or high effort. The codebase lists only low–high for Opus and none–high for Sonnet, so it is missing xhigh and max for both.

### Cited Findings
- "Claude Opus 5.5 supports all five effort levels, and `medium` is the default … Adaptive thinking is always on and can't be turned off … Requests that set `thinking: {"type": "disabled"}` return a 400 error at every effort level." — [Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- "Claude Sonnet 5.5 supports all five effort levels, and `high` is the default … For agentic coding and multistep tool use, start with `medium` for well-specified tasks and move to `high` for harder or longer ones." Also: "To turn off up-front thinking, send `thinking: {"type": "between_tools"}` … It's the lowest thinking setting on Claude Sonnet 5.5, and it works at `low`, `medium`, and `high` effort. At `xhigh` or `max`, a request with it returns a 400 error." — [Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- Level descriptions from the docs:
  - `low`: "Most efficient. Significant token savings with some capability reduction."
  - `medium`: "moderate token savings."
  - `xhigh`: "Long-running agentic and coding tasks (over 30 minutes) with token budgets in the millions."
  - `max`: "no constraints on token spending."
  - "Effort is a behavioral signal, not a strict token budget."
  - [Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- Effort with tools: "Lower effort levels tend to … make fewer tool calls … Higher effort levels may make more tool calls." Also: "follow-up requests that only process tool results can still skip thinking at any level." — [Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- Effort can change mid-conversation on Opus 5.5 and Sonnet 5.5 without losing the prompt cache, using per-message `output_config` with beta header `mid-conversation-output-config-2026-07-01`. This does not work with `between_tools`. Changing top-level effort between requests invalidates the cache. — [Anthropic effort docs](https://platform.claude.com/docs/en/build-with-claude/effort)
- Anthropic's computer-use guidance for older models: Sonnet 4.6 and Opus 4.6 should default to medium and avoid `max`. On those models, "`low` uses fewer output tokens than disabling thinking entirely (fewer mistakes mean fewer retries)". No figures were given for 5.5. — [Anthropic computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- GPT-6 Luna: "reasoning.effort supports none, low, medium (default), high, xhigh, and max" (snippet). This matches what the caller verified on the live API. — [search results incl. Tabbit / Layer3 Labs](https://go.tabbit.ai/blog/gpt-luna-6-pricing)
- GPT-6.1 Sol and GPT-6 Astra support low, medium, high, xhigh and max, per the caller's live-API check. A codebase comment says GPT-6.1 Sol "can't turn reasoning off", unlike GPT-6 Sol. — `src/lib/models.ts` (internal)

### Inferences
- For the Pareto chart:
  - Opus 5.5 has 5 points: low, medium, high, xhigh, max.
  - Sonnet 5.5 has 6 points: between_tools@low as "none", then low, medium, high, xhigh, max.
  - Sol and Astra have 5 points each.
  - Luna has 6 points.
- `between_tools` removes up-front thinking only. In a computer-use loop almost every turn comes after a tool result, so the saving versus plain `low` is probably small. That is why the model below uses a multiplier of 0.3x medium (≈0.5x low), and it is a guess.

### Gaps
- No vendor or third-party number for how many thinking tokens `between_tools` saves on Sonnet 5.5 in computer-use loops.
- Default effort for GPT-6.1 Sol and GPT-6 Astra was not confirmed from a source.

## Q3. How screenshots are tokenized and billed, and how prompt caching affects multi-step loops

### Takeaway
A 1280×800 screenshot costs about 1,330 tokens on Claude 5.5 and about 1,200–1,600 on GPT-6 models. A 1920×1080 screenshot costs about 2,700 tokens on Claude and about 2,400–2,450 on OpenAI. In a multi-step loop the screenshot history, not the model's output, dominates input. Prompt caching cuts the input bill about 5x. On the Claude models the 1.25x cache **write** of each new screenshot becomes the largest input cost.

### Cited Findings
- Claude formula: "Each patch is a 28×28-pixel block … An image, therefore, costs ⌈width / 28⌉ × ⌈height / 28⌉ visual tokens." High-resolution tier (Claude 4.7 and later, which includes Opus 5.5 and Sonnet 5.5): maximum long edge 2576 px, maximum 4,784 visual tokens. A 1920×1080 image is not resized and costs 2,691 tokens; 1000×1000 costs 1,296. — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Computer-use and browser-use screenshots that exceed the limits are **rejected**, not downscaled, so clients must resize them. When a request contains more than 20 images, a stricter per-image limit applies; the docs say to keep each side ≤2000 px. — [Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Anthropic computer-use guidance (page summarized by the fetch tool):
  - Recommended resolutions: 1280×800 or 1366×768 for web apps; 1024×768 or 1280×720 for desktop.
  - "Each screenshot typically costs 1,000–1,800 input tokens."
  - Keep ≤20 screenshots per request.
  - A suggested strategy keeps the last 3 screenshots and prunes every ~25 turns so the cached prefix stays byte-identical.
  - On Opus 5.5 with thinking, use server-side tool-result clearing instead of client pruning.
  - Place cache breakpoints after the tools and system prompt, then on the latest tool_result blocks.
  - [Anthropic computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- OpenAI GPT-6 Astra: "detail: high … uses a 65,535-pixel maximum dimension, a 2,500-patch budget, and a 1.2× multiplier" with 32 px patches (snippet quoting the OpenAI vision guide). — [OpenAI images & vision guide (snippet)](https://developers.openai.com/api/docs/guides/images-vision)
- A mini-class model (gpt-5.4-mini) uses a "1,536-patch budget and a 1.62x multiplier", so a 1920×1080 image "should cost approximately 2,400 prompt tokens". The forum thread's own title reports a bug where one 1920×1080 PNG billed about 66K tokens (snippet). — [OpenAI community thread](https://community.openai.com/t/gpt-5-4-mini-66k-prompt-tokens-for-a-1920x1080-png/1380539)
- OpenAI `detail: "original"` is recommended for OCR or coordinate work. It can still resize to meet the patch budget, and there is a separate 30,000-patch rejection limit (snippet). — [OpenAI images & vision guide (snippet)](https://developers.openai.com/api/docs/guides/images-vision)
- An image-encoding defect degraded visual understanding on GPT-6 Sol and Luna. A fix shipped around 2026-09-25, and computer-use evals run before then should be rerun (snippet). — [OpenTools](https://opentools.ai/news/openai-gpt-6-sol-luna-image-encoding-fix-retest-guide)
- Practitioner figures on browser agents (tutorial and blog snippets, moderate quality):
  - "Screenshots add 2,000-5,000 tokens per screenshot, and unpruned history alone can push a 10-step task past 150,000 tokens."
  - Hybrid DOM+screenshot is "the most expensive per step".
  - An example browser-use task made 7 LLM calls: 1,200 in / 150 out, then 2,500 in / 400 out per call.
  - [PandaStack](https://www.pandastack.ai/blog/best-browser-use-agent-frameworks-2026/); [The Neural Base](https://theneuralbase.com/browser-use/learn/advanced/cost-per-run/)
- "Your browser agent burns 114,000 tokens reading one page. Switch how it reads the page and a 10-step task drops to 3,000 tokens" (article title only; page blocked). — [Nadir blog](https://getnadir.com/blog/browser-agent-token-cost-screenshots-accessibility-tree/)

### Inferences
- Tokens per screenshot, computed:

  | Resolution | Claude 5.5 | GPT-6 Astra (detail: high) | GPT-6.1 Sol / Luna |
  |---|---|---|---|
  | 1280×800 | 46×29 = **1,334** | 40×25 = 1,000 patches × 1.2 = **~1,200** | ~1,200–1,620 (unknown; bounded by the Astra and mini-class rules) |
  | 1366×768 | 49×28 = 1,372 | | |
  | 1024×768 | 37×28 = 1,036 | | |
  | 1920×1080 | 2,691 | 60×34 = 2,040 × 1.2 = **~2,450** | |

- Cost of one 1280×800 screenshot (1,334 tokens) as fresh input / cache read / 5-minute cache write:
  - Opus 5.5: $0.0053 / $0.00027 / $0.0067
  - Sonnet 5.5: $0.0027 / $0.00027 / $0.0033
  - Sol 6.1: $0.0027 / $0.00013 / $0.0033
  - Astra: $0.0133 / $0.0013 / $0.0167
  - Luna: $0.00013 / $0.000013 / $0.00017
- How much caching saves, using the mid scenario below (15 steps, full history kept):
  - Without caching, the loop bills about 370K input tokens: Opus 5.5 ≈ $1.48 of input, Sol ≈ $0.74.
  - With caching, the same loop bills about 41K cache-write tokens plus about 329K cache-read tokens: Opus ≈ $0.27, Sol ≈ $0.14.
  - That is about a 5x cut in input cost.
- On Opus 5.5 medium, the mid task splits as: cache reads $0.066, cache writes $0.206, output $0.225. Output and new-screenshot writes dominate, not reads.
- Prompt caching needs a stable prefix. Changing top-level effort mid-task, pruning screenshots every turn, or waiting past the 5-minute TTL on long thinking steps each break the cache. The "high" scenario therefore assumes an 80% hit rate.

### Gaps
- The exact patch budgets and multipliers for GPT-6.1 Sol and GPT-6 Luna could not be retrieved (developers.openai.com is blocked). The Sol/Luna figures above are bounded, not verified.
- It is unconfirmed whether OpenAI bills automatic prompt-cache writes at 1.25x for every request. The rule is reported only by secondary sources.

## Q4. Token consumption per task and how it scales with effort

### Takeaway
No source publishes tokens per task by effort level on a computer-use or browser-use benchmark for these five models. The best effort-scaling evidence is Artificial Analysis's Intelligence Index, which reports output tokens and cost per task by effort (Table A). Output tokens rise about 7x from medium to max on Opus 5.5, about 4.5x from low to max on Sol 6.1, and about 13x in cost from medium to max on Sonnet 5.5. Agent-benchmark cost reports exist only in aggregate: OSWorld 2.0 per solved task, Browser Use relative cost, Terminal-Bench, and AutomationBench.

### Cited Findings
**Artificial Analysis Intelligence Index (all snippets)**
- **Opus 5.5**:
  - Cost per task: medium $1.34, high $1.82, xhigh $3.46, max $5.98.
  - Tokens generated over the full Index: medium 38M, high 53M, xhigh 100M, max 260M.
  - Max uses about 119K output tokens per task.
  - Index score at max is 58.
  - [AA Opus 5.5 models](https://artificialanalysis.ai/models/releases/claude-opus-5-5); [AA on X](https://x.com/ArtificialAnlys/status/2102541956014657615)
- **Sonnet 5.5**:
  - Cost per task: medium $0.59 ("lowest cost per task"), max $7.60 ("~50% higher than Sonnet 5").
  - At max it uses "~193k output tokens per Intelligence Index task, the most we have measured and ~7x that of GPT-6 Astra (max)". Tokens over the Index: 410M.
  - Score at max is 56.
  - Its low, medium and high settings "sit behind GPT-6 Sol high, xhigh, and max".
  - [AA Sonnet 5.5 article](https://artificialanalysis.ai/articles/claude-sonnet-5-5)
- Sonnet 5.5 at max ties Opus 5.5 at xhigh on the Index, but costs $7.60 vs $3.46 per task (snippet). — [THE D*AI*LY BRIEF](https://www.beri.net/article/claude-sonnet-5-5-vs-opus-5-5-cost-per-task-matched-score-effort-between-tools-migration); [OrcaRouter](https://www.orcarouter.ai/blog/claude-sonnet-5-5-cost-per-task)
- **GPT-6.1 Sol**:
  - Cost per task: low $0.13, medium $0.21, high $0.32, max $0.72.
  - Tokens over the Index: low 15M, high 25M, max 67M.
  - Scores: high 50, max 52.
  - "1 point below GPT-6 Astra … at less than one quarter of the Cost per Task."
  - [AA GPT-6.1 Sol (high)](https://artificialanalysis.ai/models/gpt-6-1-sol-high); [AA GPT-6.1 Sol (max)](https://artificialanalysis.ai/models/gpt-6-1-sol); [AA on X](https://x.com/ArtificialAnlys/status/2105025585332605357)
- **GPT-6 Astra**: "Every reasoning effort of GPT-6 Astra sits on the Intelligence Index vs Cost per Task frontier, from low at $0.82 per task to max at $3.26." Medium is $1.54. "Jumping from xhigh to max adds nothing to the intelligence score but raises the cost by roughly 40%." — [AA Benchmarking GPT-6 Astra](https://artificialanalysis.ai/articles/benchmarking-gpt-6-astra)
  - **Conflict:** another snippet in the same result set says Astra's "cost per Index task climbs from $0.46 at low effort to $1.67 at max … intelligence score moves only from 57 to 61". This is probably a third-party blog ([ML6](https://www.ml6.eu/en/blog/gpt-6-astra-cost-efficiency-and-when-to-use-it) / [KbWen](https://www.kbwen.com/gpt-6-astra-cost-per-token-and-per-task/)). The notes use the AA-attributed $0.82/$1.54/$3.26 figures.
- **GPT-6 Luna**: cost per task low $0.0045, high $0.03, max $0.07, "a 15x difference". — [AA GPT-6 Luna models](https://artificialanalysis.ai/models/releases/gpt-6-luna)
- GPT-6 Sol (the predecessor of 6.1) uses 31K output tokens per task, and GPT-6 Luna 51K, versus 29K and 41K for GPT-5.6 (snippet). GPT-6 Sol at max costs $1.06 per task. — [AA GPT-6 Sol & Luna article](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier)

**Agent and computer-use benchmarks (snippets)**
- OSWorld 2.0, from OpenAI preliminary evals: GPT-6.1 Sol is 2.1 points behind Astra, "costing roughly $9.60 per solved task against roughly $34.95 for Astra and $36.67 for Opus 5.5". It also "lands within 2.1 percentage points of Astra while running at one-seventh the cost per completed task". Effort settings were not stated; the context suggests maximum effort. — [search results incl. DataCamp / Vellum / THE D*AI*LY BRIEF](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained)
- On OSWorld 2.0, "GPT-6 Sol at xhigh matches Opus 5 at medium (60.5% against 60.3%) for about a sixth of the cost". Astra leads the OSWorld 2.0 board at 72.6%. — [llm-stats OSWorld 2.0](https://llm-stats.com/benchmarks/osworld-2.0); [BenchLM OSWorld 2.0](https://benchlm.ai/benchmarks/osworld2)
- Terminal-Bench Science 0.1 at max effort, per task: GPT-6.1 Sol $5.47, Opus 5.5 $23.21, Astra $23.80 (snippet). — [THE D*AI*LY BRIEF](https://www.beri.net/article/gpt-6-1-sol-devday-2026-astra-fifth-price-terminal-bench-score-gap-cost-per-task)
- Browser Use's own benchmark: "Sol medium scored 66.9 versus Opus 5.5's 59.4 … while costing about 3.5x less". This is GPT-6 Sol, not 6.1, and Opus's effort was not stated (snippet). — [The Neuron](https://www.theneurondaily.com/p/gpt-6-sol-vs-claude-opus-5-5); [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-vs-claude-opus-5-5-cost-benchmarks)
- AutomationBench (AA): GPT-6 Sol at xhigh scores 33.2% for $0.27 per task. GPT-6 Luna at max costs $0.037 per task (snippet). — [Digital Applied](https://www.digitalapplied.com/blog/gpt-6-sol-luna-launch-pricing-benchmarks-2026); [The Agent Report](https://the-agent-report.com/2026/09/gpt-6-sol-luna-opus-5-5-price-war/)
- In a single side-by-side run, both models took about 6 steps. "Opus 5.5 took 68 seconds and $0.33 per run against Sonnet 5.5's 48 seconds and $0.19". The task and effort were not stated (snippet). — [search results incl. THE D*AI*LY BRIEF / Kingy AI](https://www.beri.net/article/claude-sonnet-5-5-vs-opus-5-5-cost-per-task-matched-score-effort-between-tools-migration)
- HAL, the Princeton agent leaderboard, has no 5.5 or GPT-6 results yet:
  - Online Mind2Web runs cost ">$450 per evaluation".
  - HAL skipped Opus 4.1 on Online Mind2Web because it "would cost about $20,000".
  - The best agent solved 42% of Online Mind2Web.
  - [HAL paper](https://arxiv.org/html/2510.11977v1)
- Internal NaviBench, our own agent, on 2026-09-29 (a lean agent, mostly text/DOM, not screenshot-heavy):
  - gpt-6.1-sol@medium: 4-step successful tasks cost $0.0032 each in 9.7–12.6 s. 24-step failed tasks that hit the step cap cost about $0.017 in 56–58 s. That is about $0.0007–0.0008 per step.
  - gpt-6-luna@none: $0.0002 per task, 2 steps.
  - gpt-6-sol@low: $0.003–0.005 per task, 2–3 steps.
  - Files: `/home/user/chrome_navigator/bench-results/navibench-2026-09-29T23-42-01-922Z.json` and `/home/user/chrome_navigator/bench-results/navibench-2026-09-29T06-07-34-804Z.md`

### Inferences
- **Table A: effort multipliers used in the model.** Output or thinking tokens relative to each model's medium level, derived from the AA figures above. "interp." means geometric interpolation between measured neighbours; "assumed" means no data.
  - **Opus 5.5** (from AA token totals): low 0.6 (assumed), medium 1.00, high 1.39, xhigh 2.63, max 6.84.
  - **Sonnet 5.5**:
    - none (between_tools@low): 0.3 (assumed).
    - low 0.6, high 1.6, xhigh 3.5: all assumed, patterned on Opus.
    - max 11: from AA's max/medium **cost** ratio of 12.9, discounted slightly.
  - **GPT-6.1 Sol** (from AA totals of 15M/25M/67M): low 0.77, medium 1.00 (interp.), high 1.29, xhigh 2.11 (interp.), max 3.45.
  - **GPT-6 Astra** (from AA cost ratios; xhigh = max ÷ 1.4 per AA; high interp.): low 0.53, medium 1.00, high 1.23, xhigh 1.51, max 2.12.
  - **GPT-6 Luna** (from AA cost ratios; medium and xhigh interp.): none 0.05 (assumed), low 0.39, medium 1.00, high 2.59, xhigh 3.95, max 6.03.
- **Relative verbosity at medium** (Opus 5.5 = 1.0), from AA output tokens per task:
  - Opus ≈ 17K tokens per task (38M ÷ ~2,185 tasks, where the task count comes from 260M ÷ 119K).
  - Sonnet ≈ 0.9 (inferred from its $0.59 vs Opus's $1.34 at half the price).
  - Sol 6.1 ≈ 0.53 (about 9K per task, interpolated).
  - Astra ≈ 0.76 (27.6K per task at max, ÷ 2.12).
  - Luna ≈ 0.5 (51K at max, ÷ 6.03).
- AA's effort ratios come from Q&A and coding tasks where output tokens dominate the bill. In a screenshot loop, cached screenshot history dominates, so effort changes the dollar cost much less. In the model below, going from low to max raises cost per task by about 1.6x on Sol and 1.5x on Astra, but about 3.6x on Opus and 4.5x on Sonnet.
- Higher effort can also add steps ("may make more tool calls"). On Sol, AA's cost ratio from low to high (2.46x) exceeds its output-token ratio (1.67x), which suggests input grows with effort too. A sensitivity case is given in Q6.
- Cross-checks of the model against external anchors:
  1. Opus 5.5 medium over 6 steps: the model gives **$0.20**; the one reported run cost $0.33, same order of magnitude. Sonnet 5.5 medium over 6 steps: $0.10 vs $0.19 reported.
  2. The Opus/Sol cost ratio at max on the high scenario is 3.7x. OSWorld 2.0 per solved task gives 3.8x ($36.67 vs $9.60). The model's Astra/Sol ratio (5.2x) is higher than OSWorld's 3.6x, possibly because Astra needs fewer steps.
  3. OSWorld 2.0 absolute costs of about $10–37 per solved task are 3–4x above the model's "high" scenario. OSWorld 2.0 tasks are long-horizon, so treat them as a "hard desktop task" tier, not a typical one.
  4. Browser Use reported Sol ~3.5x cheaper than Opus 5.5. The model gives 2.4x at medium vs medium, same direction.
  5. NaviBench's lean agent costs about 20x less than the model's screenshot "low" scenario. DOM-first agents with small contexts sit far below screenshot agents.

### Gaps
- No public tokens-per-task by effort for any of the five models on OSWorld, WebArena, Online Mind2Web, BrowseComp or the Browser Use benchmark.
- AA data is missing for:
  - Opus 5.5 low.
  - Sonnet 5.5 low, high and xhigh (cost and tokens).
  - Sol 6.1 xhigh, and medium tokens.
  - Astra high and xhigh (only an xhigh→max +40% statement).
  - Luna none, medium and xhigh.
- The Astra cost-per-task figures conflict between sources.
- The OSWorld 2.0 per-solved-task costs come from OpenAI's own preliminary evals, reported secondhand, with unstated effort and step budgets.

## Q5. Latency per step or per task by effort (secondary axis)

### Takeaway
Latency data is thin. OpenAI output speeds are known from AA snippets: Luna ≈157 tokens/s, GPT-6 Sol ≈104 tokens/s, Astra (max) ≈57–59 tokens/s, and up to 300 tokens/s on Ultrafast. No output speed was found for Opus 5.5 or Sonnet 5.5. One reported run suggests about 11 s per step on Opus 5.5 and about 8 s on Sonnet 5.5.

### Cited Findings
- Output speed: "Luna is reported at 157.2 output tokens per second, GPT-6 Sol at 104.4". GPT-6 Astra (max) runs at 57.0–59.1 tokens/s. GPT-6 Sol non-reasoning has a 1.11 s time to first token (snippets). — [AA comparison pages](https://artificialanalysis.ai/models/comparisons/gpt-6-astra-vs-gpt-5-6-sol); [AA GPT-6 Sol models](https://artificialanalysis.ai/models/releases/gpt-6-sol)
- Ultrafast reaches up to 300 tokens/s: "up to 6X faster generation through the API" (snippet). — [VentureBeat](https://venturebeat.com/technology/openais-gpt-6-1-sol-offers-astra-like-performance-at-1-5th-price-a-new-ultrafast-tier-clocks-at-300-tokens-per-second)
- Anthropic fast mode gives "significantly faster output" for Opus 5.5. No speed figure is on the pricing page. — [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- A single run took about 6 steps: Opus 5.5 in 68 s, Sonnet 5.5 in 48 s (snippet). — [THE D*AI*LY BRIEF](https://www.beri.net/article/claude-sonnet-5-5-vs-opus-5-5-cost-per-task-matched-score-effort-between-tools-migration)
- Internal NaviBench, gpt-6.1-sol@medium: about 2.4 s per step (4 steps in 9.7–12.6 s; 24 steps in 56–58 s). — `/home/user/chrome_navigator/bench-results/navibench-2026-09-29T23-42-01-922Z.md`

### Inferences
- Per-step latency ≈ TTFT + (output tokens per step ÷ output speed) + environment time. Using mid-scenario output per step:
  - **Sol:** medium ≈ 470 tokens → ~4.5 s; max ≈ 1,250 → ~12 s. Both assume GPT-6 Sol's 104 tokens/s.
  - **Luna:** medium ≈ 450 → ~2.9 s; max ≈ 1,960 → ~12.5 s.
  - **Astra:** medium ≈ 610 → ~10.5 s; max ≈ 1,120 → ~19 s.
  - Each figure excludes TTFT and screenshot capture.
- Multiply by the step count (N = 15 mid) for task latency. Excluding TTFT and environment time, that gives about 1–3 minutes on Sol, Luna and Astra. Opus 5.5 and Sonnet 5.5 at about 8–11 s per step (one data point) come to about 2–3 minutes.

### Gaps
- No measured output speed for Opus 5.5, Sonnet 5.5 or GPT-6.1 Sol specifically.
- No effort-level latency on any computer-use benchmark.

## Q6. Estimated dollars per task for each model × effort (cost axis for the Pareto chart)

### Takeaway
On a typical 15-step screenshot task with prompt caching, estimated costs are:
- GPT-6 Luna: about **$0.01–0.02**
- GPT-6.1 Sol: about **$0.19–0.32**
- Claude Sonnet 5.5: about **$0.22–1.08**
- Claude Opus 5.5: about **$0.42–1.55**
- GPT-6 Astra: about **$1.14–1.68**

Each range runs from the lowest to the highest effort. The low-to-high scenario band around each point is roughly 0.3x to 9x. Astra is the most expensive at every effort because its per-token input price is 2.5–5x the others'. Effort matters most for the Claude models, especially Sonnet at max.

### Cited Findings
- Prices: see Q1 ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), plus the OpenAI snippets cited there).
- Toolset overhead: 4,500–6,600 tokens ([Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
- Screenshot tokens: 1,334 at 1280×800 on Claude ([Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)); 1,000–1,800 typical ([Anthropic computer use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)).
- Effort multipliers: Q4 Table A, from Artificial Analysis snippets.

### Inferences
**Model and formula.** The script is at `/tmp/claude-0/-home-user-chrome-navigator/1fcb0ef8-dc93-59f1-9196-a6057814dafa/scratchpad/cost_model.py`; the formula is reproduced here.

For step i = 1..N:
- cached_i = P + (i−1)(S+T) + (i−2)·A when i ≥ 2, and 0 when i = 1.
- new_i = P+S+T when i = 1, and A+S+T when i ≥ 2. New content is written to cache at the cache-write price.
- hit share of cached_i is billed at the cache-read price; the rest at the fresh-input price.
- Output per step = A + H_ref × V_model × M_effort.

Task cost = Σ(fresh·p_in + read·p_read + write·p_write) + N·output·p_out.

Variables:
- P = fixed prefix (system prompt, tool definitions, task).
- S = screenshot tokens.
- T = text observation per step (action result, URL, some accessibility or DOM text).
- A = visible output per step (tool call plus brief text).
- H_ref = thinking tokens per step for Opus 5.5 at medium.
- V = relative verbosity; M = effort multiplier (both from Table A).

Scenario values:

| Scenario | N steps | P | S | T | A | H_ref | Cache hit |
|---|---|---|---|---|---|---|---|
| low (short, lean task) | 8 | 4,000 | 1,100 | 300 | 100 | 250 | 100% |
| **mid (typical)** | 15 | 6,000 | 1,400 | 800 | 150 | 600 | 100% |
| high (long, heavy task) | 30 | 8,000 | 2,700 (1920×1080) | 3,000 (large accessibility tree) | 250 | 1,500 | 80% |

Assumptions and caveats:
- The full history is kept with no pruning, which gives an upper bound on input. Pruning to the last 3 screenshots would cut cache reads in the high scenario but add periodic cache rebuilds.
- Thinking tokens from earlier steps are not re-billed as input.
- The step count does not vary with effort.
- The same screenshot token count is used for every vendor. They differ by less than about 20% at 1280×800.
- OpenAI cache writes are billed at 1.25x. At 1.0x the OpenAI totals fall about 8–10%.
- H_ref of 600 is an assumption: no source gives per-step thinking for computer use. The low–high values of 250–1,500 bracket it.

Model-independent input totals:
- low: 15.9K cache-write + 69.3K cache-read
- mid: 41.1K cache-write + 328.7K cache-read
- high: 562.6K fresh (cache misses) + 186.3K cache-write + 2.25M cache-read

Sensitivity to step inflation at higher effort (mid scenario):
- **max with 1.5x steps:** Opus $2.40, Sonnet $1.70, Sol $0.51, Astra $2.76, Luna $0.037.
- **xhigh with 1.25x steps:** Opus $1.01, Sonnet $0.62, Sol $0.33, Astra $1.94, Luna $0.024.

Other points for the chart:
- Premium modes: multiply by 2x for Opus fast mode or OpenAI Fast, 6x for OpenAI Ultrafast, 0.5x for Batch/Flex, and 1.1x for Anthropic US-only inference.
- Cost per **successful** task = cost per task ÷ success rate. This matters for Pareto charts: Sol's OSWorld 2.0 figure of $9.60 is per solved task.
- Lean DOM-first agents such as Navi run about 20x below these screenshot-agent figures. NaviBench measured about $0.003 per 4-step task on Sol medium.

### Gaps
- Per-step thinking tokens (H_ref) and step counts for each model × effort on real computer-use tasks are unmeasured in public sources. They are the largest source of uncertainty, and a local sweep (NaviBench with a screenshot mode) would pin them down.
- Luna's and Sol's image token rules are unverified.
- It is unknown whether higher effort changes the number of steps or screenshots per task for these models.

### Table 1: Price table per model (USD per 1M tokens)

| Model | Input | Cache read / cached input | Cache write | Output | Fast / priority | Batch / Flex | Long-context surcharge | Source status |
|---|---|---|---|---|---|---|---|---|
| Claude Opus 5.5 | $4.00 | $0.20 (0.05x) | $5.00 (5 min, 1.25x); $8.00 (1 h, 2x) | $20.00 | Fast mode $8 / $40 (2x), cache multipliers stack, first-party API only | Batch $2 / $10 | None (1M context at standard rate); US-only inference 1.1x | Verified: Anthropic pricing page |
| Claude Sonnet 5.5 | $2.00 | $0.20 (0.1x) | $2.50 (5 min); $4.00 (1 h) | $10.00 | No fast mode listed | Batch $1 / $5 | None; US-only 1.1x | Verified: Anthropic pricing page |
| GPT-6.1 Sol | $2.00 | $0.10 (0.05x) | $2.50 (1.25x); **codebase has $2** | $10.00 | Fast 2x; Ultrafast 6x (Sol 6.1 "coming days") | Batch and Flex 50% off | >272K input: 2x input/cache, 1.5x output, for the whole request | Search snippets (multiple agreeing sources) |
| GPT-6 Astra | $10.00 | $1.00 (0.1x) | $12.50 (1.25x); **codebase has $10** | $50.00 | Fast 2x; Ultrafast 6x (GA) | 50% off | Probably the same 272K rule (unconfirmed) | Search snippets |
| GPT-6 Luna | $0.10 | $0.01 (0.1x) | $0.125 (1.25x); **codebase has $0.10** | $0.50 | Not found | 50% off (assumed, per family rule; unconfirmed) | Unconfirmed | Search snippets |

### Table 2: Estimated tokens and dollars per task by model and effort

Screenshot-based computer-use or browser-use agent with prompt caching. Token columns are for the **mid** scenario (15 steps, 1280×800 screenshots).
- **Input** = uncached input, all billed as 5-minute cache writes.
- **Cached** = cache reads.
- **Output** = thinking plus visible output.

Every row has the same input and cached counts: 41,100 input (all cache writes) and 328,650 cached. Low and high scenario token totals are given in Q6 Inferences.

| Model | Effort | Mid tokens per task (input / cached / output) | $ per task: low / **mid** / high | Basis |
|---|---|---|---|---|
| Opus 5.5 | low | 41.1K / 328.7K / 7.7K | $0.13 / **$0.42** / $4.32 | Model in Q6; effort multiplier 0.6 (assumed, no AA low data) |
| Opus 5.5 | medium (default) | 41.1K / 328.7K / 11.3K | $0.15 / **$0.50** / $4.68 | AA medium (38M tokens, $1.34 per Index task); matches a reported 6-step run of $0.33 (model gives $0.20) |
| Opus 5.5 | high | 41.1K / 328.7K / 14.8K | $0.17 / **$0.57** / $5.03 | AA high 53M tokens = 1.39x medium |
| Opus 5.5 | xhigh | 41.1K / 328.7K / 25.9K | $0.21 / **$0.79** / $6.15 | AA xhigh 100M = 2.63x |
| Opus 5.5 | max | 41.1K / 328.7K / 63.8K | $0.38 / **$1.55** / $9.94 (up to $2.40 mid with 1.5x steps) | AA max 260M = 6.84x, 119K output per Index task; OSWorld 2.0 ≈ $36.67 per solved task (long-horizon) |
| Opus 5.5 | any, fast mode | same | 2x the row above | Anthropic fast mode $8 / $40 |
| Sonnet 5.5 | none (between_tools@low) | 41.1K / 328.7K / 4.7K | $0.07 / **$0.22** / $2.24 | Assumed 0.3x medium thinking; no data |
| Sonnet 5.5 | low | 41.1K / 328.7K / 7.1K | $0.07 / **$0.24** / $2.36 | Assumed 0.6x |
| Sonnet 5.5 | medium | 41.1K / 328.7K / 10.4K | $0.08 / **$0.27** / $2.52 | AA medium $0.59 per Index task (≈0.9x Opus medium tokens); a reported 6-step run cost $0.19 (model gives $0.10) |
| Sonnet 5.5 | high (default) | 41.1K / 328.7K / 15.2K | $0.09 / **$0.32** / $2.76 | Assumed 1.6x |
| Sonnet 5.5 | xhigh | 41.1K / 328.7K / 30.6K | $0.12 / **$0.47** / $3.53 | Assumed 3.5x |
| Sonnet 5.5 | max | 41.1K / 328.7K / 91.4K | $0.26 / **$1.08** / $6.57 (up to $1.70 mid with 1.5x steps) | AA max $7.60 per Index task (12.9x medium), 193K output per task |
| GPT-6.1 Sol | low | 41.1K / 328.7K / 5.9K | $0.06 / **$0.19** / $2.08 | AA low 15M tokens, $0.13 per Index task; NaviBench lean agent ≈ $0.003 per task (different agent type) |
| GPT-6.1 Sol | medium | 41.1K / 328.7K / 7.0K | $0.07 / **$0.21** / $2.13 | AA medium $0.21 per Index task; Browser Use: GPT-6 Sol medium ~3.5x cheaper than Opus 5.5 |
| GPT-6.1 Sol | high | 41.1K / 328.7K / 8.4K | $0.07 / **$0.22** / $2.20 | AA high 25M, $0.32 |
| GPT-6.1 Sol | xhigh | 41.1K / 328.7K / 12.3K | $0.08 / **$0.26** / $2.39 | Interpolated (no AA xhigh); GPT-6 Sol xhigh $0.27 per AutomationBench task |
| GPT-6.1 Sol | max | 41.1K / 328.7K / 18.7K | $0.09 / **$0.32** / $2.71 (up to $0.51 mid with 1.5x steps) | AA max 67M, $0.72; OSWorld 2.0 ≈ $9.60 per solved task (long-horizon); Terminal-Bench Science $5.47 |
| GPT-6 Astra | low | 41.1K / 328.7K / 5.9K | $0.35 / **$1.14** / $11.49 | AA low $0.82 per Index task (conflicting source: $0.46) |
| GPT-6 Astra | medium | 41.1K / 328.7K / 9.1K | $0.38 / **$1.30** / $12.29 | AA medium $1.54 |
| GPT-6 Astra | high | 41.1K / 328.7K / 10.7K | $0.40 / **$1.38** / $12.68 | Interpolated |
| GPT-6 Astra | xhigh | 41.1K / 328.7K / 12.6K | $0.42 / **$1.47** / $13.16 | AA: max is ~40% above xhigh |
| GPT-6 Astra | max | 41.1K / 328.7K / 16.8K | $0.47 / **$1.68** / $14.21 (up to $2.76 mid with 1.5x steps) | AA max $3.26; about 27.6K output per Index task; OSWorld 2.0 ≈ $34.95 per solved task |
| GPT-6 Luna | none | 41.1K / 328.7K / 2.5K | $0.003 / **$0.010** / $0.11 | Assumed 0.05x medium thinking; NaviBench lean agent $0.0002 per task |
| GPT-6 Luna | low | 41.1K / 328.7K / 4.0K | $0.003 / **$0.010** / $0.11 | AA low $0.0045 per Index task |
| GPT-6 Luna | medium (default) | 41.1K / 328.7K / 6.8K | $0.004 / **$0.012** / $0.12 | Interpolated |
| GPT-6 Luna | high | 41.1K / 328.7K / 13.9K | $0.004 / **$0.015** / $0.14 | AA high $0.03 |
| GPT-6 Luna | xhigh | 41.1K / 328.7K / 20.0K | $0.005 / **$0.018** / $0.15 | Interpolated |
| GPT-6 Luna | max | 41.1K / 328.7K / 29.4K | $0.006 / **$0.023** / $0.17 (up to $0.037 mid with 1.5x steps) | AA max $0.07, about 51K output per Index task; AutomationBench max $0.037 per task |

How to read the table:
- **Low column** (8 steps, 1,100-token screenshots, 250 thinking tokens per step at Opus-medium): a short, simple task on a lean prompt.
- **High column** (30 steps, 1920×1080 screenshots, large accessibility trees, 1,500 thinking tokens per step at Opus-medium, 80% cache hit rate): a long, heavy task.
- Long-horizon benchmark tasks such as OSWorld 2.0 are reported at about 3–4x the high column per solved task.
- For a cost-per-success axis, divide by each point's measured success rate.
