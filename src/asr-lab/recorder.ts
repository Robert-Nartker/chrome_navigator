// Records the user's own mic saying Navi's commands, for the speech benchmark (bench/asr): simulated
// headset audio only goes so far. One click, then each command shows for a few seconds while it's
// recorded; at the end the clips download as one file. Nothing is sent anywhere.

/** What to say: every single word Navi knows, the commands said most, a few long ones, and one sentence of chatter. */
export const PROMPTS = [
  "pause", "play", "stop", "mute", "unmute", "refresh", "flags", "grid", "louder", "quieter", "help",
  "scroll down", "scroll up", "go back", "close tab", "new tab", "next tab", "zoom in", "click 5",
  "pause the video", "play the video", "go to sleep", "wake up", "stay awake", "next heading",
  "read this page", "skip ahead 30 seconds", "volume up", "delete that", "use Whisper",
  "open YouTube", "search YouTube for lofi beats", "type hello world", "switch to tab 3", "scroll down a little",
  "I'll call you back later",
];

/** Seconds recorded for each prompt. */
export const CLIP_S = 3.5;
const RATE = 16000;

/** 16-bit mono WAV. */
export function wav(pcm: Float32Array, rate = RATE): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (at: number, s: string) => [...s].forEach((c, i) => out.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  out.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, "data");
  out.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true));
  return new Uint8Array(out.buffer);
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface Recording {
  text: string;
  pcm: Float32Array;
}

/** The file the benchmark reads: the mic's name and each clip as a WAV. */
export function recordingFile(device: string, clips: Recording[]): string {
  return JSON.stringify({
    kind: "navi-mic-recording",
    device,
    browser: navigator.userAgent,
    rate: RATE,
    clips: clips.map((c) => ({ text: c.text, wav: base64(wav(c.pcm)) })),
  });
}

/**
 * Records each prompt for CLIP_S seconds, with the mic settings Navi listens with (echo cancellation on,
 * noise suppression off, automatic gain on) and the mic chosen in Navi's settings.
 */
export async function recordPrompts(
  deviceId: string,
  onPrompt: (text: string, index: number) => void,
  signal: AbortSignal,
  clipSeconds = CLIP_S,
): Promise<{ device: string; clips: Recording[] }> {
  const audio: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 };
  const stream = await navigator.mediaDevices
    .getUserMedia({ audio: deviceId ? { ...audio, deviceId: { exact: deviceId } } : audio })
    .catch(() => navigator.mediaDevices.getUserMedia({ audio }));
  const device = stream.getAudioTracks()[0]?.label ?? "";
  const ctx = new AudioContext({ sampleRate: RATE });
  let chunks: Float32Array[] = [];
  const node = ctx.createScriptProcessor(1024, 1, 1);
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination);
  const clips: Recording[] = [];
  try {
    for (const [i, text] of PROMPTS.entries()) {
      if (signal.aborted) break;
      chunks = [];
      onPrompt(text, i);
      await new Promise((resolve) => setTimeout(resolve, clipSeconds * 1000));
      const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        pcm.set(c, at);
        at += c.length;
      }
      clips.push({ text, pcm });
    }
  } finally {
    node.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }
  return { device, clips };
}
