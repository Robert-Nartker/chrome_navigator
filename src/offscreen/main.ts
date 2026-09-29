// Navi's background page (an offscreen document): hosts the ears and voice, and passes what they hear
// to the background worker, which runs the commands. Offscreen documents can only use chrome.runtime,
// so settings arrive from the worker.

import { Ears } from "../ears/ears";
import { startDevReload } from "../lib/dev-reload";
import type { EarsEvent, EarsRequest } from "../lib/messages";
import { nanoStatus, runNano } from "../lib/nano";

const send = (event: EarsEvent) => void chrome.runtime.sendMessage(event).catch(() => undefined);

const ears = new Ears({
  command: (text, confidence) => send({ type: "ears:command", text, confidence }),
  cancel: () => send({ type: "ears:cancel" }),
  state: (state) => send({ type: "ears:state", state }),
  interim: (text) => send({ type: "ears:interim", text }),
  log: (kind, text) => send({ type: "ears:log", kind, text }),
  dictation: (text, final) => send({ type: "ears:dictation", text, final }),
});

// (Other parts' messages arrive here too; anything that isn't an ears request falls to `default`.)
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as EarsRequest;
  switch (msg.type) {
    case "ears:configure":
      ears.configure(msg.settings);
      return false;
    case "ears:listen":
      void ears.listen(msg.on).then(() => sendResponse(true));
      return true;
    case "ears:say":
      void ears.say(msg.text).then(() => sendResponse(true));
      return true;
    case "ears:stop-speaking":
      ears.stopSpeaking();
      return false;
    case "ears:sound":
      ears.sound(msg.name);
      return false;
    case "ears:session":
      if (msg.action === "sleep") ears.sleep();
      else if (msg.action === "wake") ears.wake();
      else ears.touch();
      return false;
    case "ears:dictate":
      void ears.dictate(msg.on).then(() => sendResponse(true));
      return true;
    case "nano:prompt":
      runNano(msg.req).then(
        (text) => sendResponse({ text }),
        (err: unknown) => sendResponse({ error: err instanceof Error ? err.message : String(err) }),
      );
      return true;
    case "nano:status":
      void nanoStatus().then(sendResponse);
      return true;
    case "ears:test":
      sendResponse(test(msg));
      return false;
    default:
      return false;
  }
});

/** Hooks for automated tests (reached through the worker). */
function test(msg: Extract<EarsRequest, { type: "ears:test" }>): unknown {
  switch (msg.action) {
    case "final":
      ears.final(msg.text ?? "", msg.confidence ?? 0);
      return true;
    case "state":
      return ears.state;
    case "session":
      return ears.session.current;
    case "speakerBusy":
      return ears.speaker.busy;
    case "lastSaid":
      return ears.speaker.lastSaid;
    case "mute":
      ears.speaker.muted = !!msg.muted;
      return true;
  }
}

// Keeps the background worker awake while Navi listens (Chrome stops idle workers after 30 s).
setInterval(() => send({ type: "ears:heartbeat" }), 20_000);

send({ type: "ears:ready" });
if (__DEV__) void startDevReload(() => undefined, { background: true });
