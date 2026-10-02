# Navi accessibility map

*Draft, 2026-10-02. For the research expo deliverable: user groups, needs, impact, requirements and goals. Figures from outside sources are linked; check them before publishing.*

## In one paragraph

Navi lets people use the web by talking to it: built-in commands for everyday browsing ("scroll down", "click 5", "go back"), a pointer you can steer by voice (the grid), dictation, and an AI that does whole tasks ("reply to Sarah that I'm running late"). For people who can't use a mouse and keyboard, or can't see the screen, that's access to the web on their own terms. For everyone else it's a faster way to work. The same features serve both groups, the "curb-cut effect": features built for disability end up helping everyone. Accessibility is what makes Navi stand out at the expo. Productivity is what will make people keep it installed once it's open source.

## Who Navi is for

| Group | Examples | What they need from a browser | What Navi does today | Biggest gaps |
|---|---|---|---|---|
| **Can't use hands or arms** (permanently) | Spinal cord injury (tetraplegia), ALS/MND, muscular dystrophy, limb difference or amputation, cerebral palsy | Everything hands-free, from the moment the computer starts; precise pointing without a mouse; typing without a keyboard; low effort per action | On from Chrome start; wake word; built-in commands; number tags and the mouse grid (click, double-click, right-click anywhere); dictation; AI tasks; the spoken tutorial | Recognition reliability (the #1 problem); dragging, hovering, text selection and editing by voice; setup still needs a few clicks (mic permission) |
| **Limited or painful hand use** | Arthritis, RSI and carpal tunnel, tremor (Parkinson's, essential tremor), MS, stroke | Fewer, bigger actions; no fine pointing; rest for hands | All of the above, plus mixing voice with some mouse use | Same as above; a push-to-talk key or foot pedal for people who can press one |
| **Temporary injury** | A cast, a broken wrist, after surgery (Theo Browne coded through two casts with dictation and agents) | Get work done for weeks without a learning curve | Natural phrasing goes to the AI; the tutorial | Dictation as good as Wispr Flow (accuracy, cleanup) |
| **Blind** | Screen reader users (NVDA, JAWS, VoiceOver) | Know what's on the page; move through it by structure (headings, links, fields); fill forms; do multi-step tasks without hunting | "Describe the screen", "read this page", "where am I", "click" plus a name; spoken feedback for everything; AI tasks that skip the hunting | Navigating by structure ("next heading", "list links", "next field"); sharing audio with a screen reader without talking over it; the visual number tags don't help |
| **Low vision** | Macular degeneration, glaucoma, cataracts | Large text, zoom, high contrast, less reading | "Zoom in", reading aloud, describe the screen, the big caption in the panel | High-contrast caption and number tags; automatic page zoom |
| **Cognitive and learning differences** | Dyslexia, ADHD, brain injury | Less reading and fewer steps; plain language; help staying on task | Reading aloud, summaries, "do it for me" tasks, threads for separate tasks | A "simple mode": fewer options, slower speech, step-by-step confirmations |
| **Atypical speech** | Dysarthria (ALS, cerebral palsy, stroke), stutter, strong accent | Recognition that understands them | Typing to Navi; mishearing fixes (router, sound-alikes) | Off-the-shelf recognizers do poorly here. A personal voice model (like Google's Project Relate) is a long-term research question |
| **Older adults, less technical users** | First-time computer users | Ask in their own words; no jargon | Natural requests go to the AI; the tutorial | A "what can I do here" helper; gentler wording |
| **Productivity users** (the open-source audience) | Developers, writers, researchers, multitaskers | Speed: hands on the keyboard, voice for the rest; agents doing errands in the background | Helpers working in their own windows; threads; personal voice commands; Navi kept in one window while you work in another | Push-to-talk, dictation quality, cost visibility |

Scale, for context: about 1.3 billion people (1 in 6) live with significant disability ([WHO](https://www.who.int/news-room/fact-sheets/detail/disability-and-health)), at least 2.2 billion have a near or distance vision impairment ([WHO](https://www.who.int/news-room/fact-sheets/detail/blindness-and-visual-impairment)), and over 15 million live with a spinal cord injury ([WHO](https://www.who.int/news-room/fact-sheets/detail/spinal-cord-injury)).

## Requirements

**Must have (MVP and expo).** Each one has a target that can be tested.

1. **Hands-free from start to finish.** After a one-time setup, using Navi needs no keyboard or mouse: it starts with Chrome, wakes by voice, and every feature has a spoken command. *Target:* each of the 10 core tasks below can be done by voice alone.
2. **Reliable recognition of commands.** *Targets:* in a quiet room, at least 95% of built-in commands run correctly on the first try. A phrase is never held or dropped silently: it runs, or Navi says it didn't understand, within 1.5 s of the user stopping. Navi is never deaf for more than 1 s at a time.
3. **Fast.** *Targets:* built-in commands act within 1 s of the user stopping; AI tasks say what they're doing within 2 s.
4. **Usable without seeing the screen.** Spoken feedback for every action; "describe the screen"; reading; no step that depends on reading the screen. *Target:* a blind tester completes the core tasks with spoken feedback only.
5. **Precise pointing without a mouse.** Number tags and the grid reach any spot on the page. *Target:* any visible target is reachable in 3 commands or fewer.
6. **Safe.** Nothing that can't be undone (sending, buying, deleting, closing unsaved work) without the user's OK, unless they chose otherwise (YOLO). Page content can't instruct the AI.
7. **Private.** Speech recognition runs on the computer; AI services keep no data; the user's API key stays in their browser.
8. **Light on the computer.** Off means nothing loaded; idle models unload. *Target:* Navi off adds no memory or graphics-memory use.
9. **Works in a noisy room** (the expo). *Target:* at least 90% of commands succeed with conversation and music in the background, using a close mic.
10. **Teaches itself.** The spoken tutorial gets a new user from zero to the core tasks without help.

**Core tasks** for testing: open a site; search; scroll and read; click a link by name and by number; fill in a form field; go back and switch tabs; read an article aloud; ask a question about the page; have the AI do a multi-step errand; stop Navi mid-task.

**Should have (next).** Navigation by structure (headings, links, form fields, landmarks). Full dictation editing ("delete that", "select the last sentence", "capitalize that"). Drag and hover by voice. Push-to-talk on a key, switch or foot pedal. Voice ID for shared spaces. Screen reader coexistence (Navi waits while the screen reader talks). A simple mode.

## Goals

1. **The expo:** show a person doing everyday web tasks without touching the computer, fast and reliably, in a loud room. Show the same tool making a productivity user faster.
2. **Measured, not claimed:** a small study with people from at least two groups (motor and vision) doing the core tasks with Navi and with their usual tools.
3. **Open source and used:** a public release that people install and keep using. Success means weekly active users and community commands or plugins, not just stars.

## How to measure impact

| Measure | How | Why it matters |
|---|---|---|
| Task success rate | Core tasks, with and without help | Can people do it at all? |
| Time per task | Navi vs the participant's usual method (Voice Control, Voice Access, a screen reader, or keyboard and mouse) | Is it faster? |
| Commands per task, and failed commands | Navi's usage log (already records every command) | Effort, frustration |
| Recognition accuracy | Command success on first try; misheard and dropped phrases | The main risk |
| SUS score (System Usability Scale) | A standard 10-question survey | Comparable with other studies |
| Fatigue and comfort | A short post-session rating | Matters for people with limited energy or pain |
| Cost | Navi's cost log, per hour of use | Affordability (Free mode costs nothing) |

A study with disabled participants should go through the university's ethics review (IRB) before it starts. Recruit through campus disability services and local organizations.

## Gaps, in order

| Priority | Gap | Who it's for | Roadmap |
|---|---|---|---|
| P0 | Recognition reliability (misheard short commands; held or dropped phrases, fixed 2026-10-02 but needs real-world checking) | Everyone | Item 7 |
| P0 | A real wake word | Everyone hands-free | Item 7 |
| P0 | Loud-room performance for the expo: close mic, push-to-talk, Voice ID | Expo, shared spaces | Items 7 and 8 |
| P1 | Navigation by structure: headings, links, fields, landmarks | Blind, low vision | New |
| P1 | Dictation editing commands | Motor | New |
| P1 | Screen reader coexistence | Blind | New |
| P1 | Push-to-talk on a key, switch or pedal | Partial hand use, noisy rooms | Item 7 |
| P2 | Drag, hover and text selection by voice | Motor | New |
| P2 | Simple mode | Cognitive, older adults | New |
| P2 | High-contrast caption and tags | Low vision | New |
| P3 | Personal speech models for atypical speech | Atypical speech | Research |

## Expo demo plan

- **Setup:** a close-talking or podium mic (it rejects room noise far better than a laptop mic), Navi pinned to the demo window, Pro mode, spoken feedback on.
- **Story 1, hands-free (about 2 min):** "Hey Navi, open Wikipedia", "search for octopus", "describe the screen", "click 3", "read this page", "stop", "go back". No hands, eyes closed for part of it.
- **Story 2, productivity (about 1 min):** "Find me three standing desks under $400 and compare them". Helpers work in their own windows while the presenter keeps talking; the reports come back and Navi sums them up.
- **Fallbacks:** typed commands in the panel; a recorded video of both stories in case the room is too loud.

## Open questions for the track leads

- Which groups should the study focus on: motor only, or motor and vision?
- Is a short study possible before the expo, or should it be the plan for after?
- Should the demo show Free (no cost, on-device) or Pro (more capable)?
