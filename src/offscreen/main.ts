// Navi's background page (an offscreen document): hosts the ears and voice, and passes what they hear
// to the background worker, which runs the commands. Offscreen documents can only use chrome.runtime,
// so settings arrive from the worker.

import { Ears } from "../ears/ears";
import { startDevReload } from "../lib/dev-reload";
import type { EarsEvent, EarsRequest } from "../lib/messages";

const send = (event: EarsEvent) => void chrome.runtime.sendMessage(event).catch(() => undefined);

const ears = new Ears({
  command: (text, confidence) => send({ type: "ears:command", text, confidence }),
  cancel: () => send({ type: "ears:cancel" }),
  state: (state) => send({ type: "ears:state", state }),
  interim: (text) => send({ type: "ears:interim", text }),
  log: (kind, text) => send({ type: "ears:log", kind, text }),
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
      else ears.touch();
      return false;
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
    case "chromeFinal":
      ears.chromeFinal(msg.text ?? "", msg.confidence ?? 0);
      return true;
    case "feedScribe":
      ears.feedScribe(msg.level ?? 0.3, msg.chunks ?? 8);
      return true;
    case "state":
      return ears.state;
    case "scribeLive":
      return ears.scribeLive;
    case "session":
      return ears.session.current;
    case "speakerBusy":
      return ears.speaker.busy;
    case "mute":
      ears.speaker.muted = !!msg.muted;
      return true;
  }
}

// Keeps the background worker awake while Navi listens (Chrome stops idle workers after 30 s).
setInterval(() => send({ type: "ears:heartbeat" }), 20_000);

send({ type: "ears:ready" });
if (__DEV__) void startDevReload(() => undefined, { background: true });
