# Working on Navi

Navi is a voice-first Chrome extension. Read README.md for the layout, CHANGELOG.md for what shipped, and ROADMAP.md for what's planned.

## Principles for every feature

- **Voice first.** Every feature works by voice, with the side panel closed: a spoken command for it (and a few natural phrasings, plus common mishearings), spoken feedback, and the router told about it (`BUILT_IN_COMMANDS` in `src/lib/router.ts`). Buttons are a second way in, never the only one.
- **Accessible to people who can't see the screen or use a mouse and keyboard.** Nothing needs a click except the one-time mic and on-device speech setup. Anything shown is also said (in spoken-feedback mode), and panel controls have labels a screen reader reads.
- **Navi's window.** Anything Navi opens, shows or acts on goes to Navi's window (`naviWindowId()` in `src/lib/browser.ts`: the command's window, else the pinned one, else the user's), never just "the last focused window".
- **Light on the computer.** Models (Navi's voice, Parakeet, Gemini Nano sessions) load only when needed, unload when idle, and are all freed when Navi is turned off.
- **Private.** Speech recognition runs on the computer; every AI service is used with zero data retention; page content is untrusted and never treated as instructions.

## Testing

- `npm run check` runs types, lint, unit tests and the browser tests (Playwright, headless Chromium with fake speech and fake AI replies).
- The fakes can't show real recognizer behavior, real voices or real focus changes across windows. For anything touching listening, windows or speech, add a browser test that reproduces the real situation as closely as the fakes allow (two windows, a recognizer that holds or drops a phrase), and check that the test fails without the fix.
