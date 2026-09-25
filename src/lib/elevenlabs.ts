// ElevenLabs: Scribe v2 Realtime (speech-to-text) and streaming text-to-speech.
// Endpoints and parameters follow ElevenLabs' official JS SDKs
// (elevenlabs/packages client/src/scribe, elevenlabs/elevenlabs-js textToSpeech).

const API = "https://api.elevenlabs.io";
const REALTIME_STT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export const STT_MODEL = "scribe_v2_realtime";

/** Calm female default ("Sarah", an ElevenLabs premade voice); changeable in settings. */
export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export const TTS_MODELS = [
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fastest, ~75 ms)" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5 (balanced)" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (richest, slower)" },
] as const;

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** fetch, with a plain message when ElevenLabs can't be reached (instead of "Failed to fetch"). */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new ElevenLabsError("Couldn't reach ElevenLabs. Check your internet connection.");
  }
}

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  if (res.status === 401) throw new ElevenLabsError("ElevenLabs rejected the API key. Check it in Navi's settings.", 401);
  if (res.status === 429) throw new ElevenLabsError("ElevenLabs rate limit or quota reached.", 429);
  throw new ElevenLabsError(`ElevenLabs ${what} failed (${res.status}).`, res.status);
}

/** A single-use token so the realtime socket never carries the API key. */
export async function realtimeToken(apiKey: string): Promise<string> {
  const res = await check(
    await send(`${API}/v1/single-use-token/realtime_scribe`, { method: "POST", headers: { "xi-api-key": apiKey } }),
    "token request",
  );
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new ElevenLabsError("ElevenLabs didn't return a token.");
  return body.token;
}

export interface ScribeOptions {
  token: string;
  languageCode: string;
  keyterms: string[];
  /** Ignore nearby conversations and ambient noise (server-side). */
  filterBackgroundAudio: boolean;
  /** Seconds of silence that end an utterance. */
  silenceSecs: number;
}

export function scribeUrl(o: ScribeOptions): string {
  const params = new URLSearchParams({
    model_id: STT_MODEL,
    token: o.token,
    audio_format: "pcm_16000",
    commit_strategy: "vad",
    vad_silence_threshold_secs: String(Math.min(3, Math.max(0.3, o.silenceSecs))),
    language_code: o.languageCode.slice(0, 2),
    // Drop "um"s and false starts; commands come through cleaner.
    no_verbatim: "true",
    filter_background_audio: String(o.filterBackgroundAudio),
    // Zero-retention mode (enable_logging=false) is Enterprise-only, so it isn't requested.
  });
  // Max 50 keyterms, 20 characters each.
  for (const term of o.keyterms.filter((t) => t.length <= 20).slice(0, 50)) params.append("keyterms", term);
  return `${REALTIME_STT}?${params}`;
}

export interface VoiceSettings {
  voiceId: string;
  model: string;
  /** 0.7-1.2 */
  speed: number;
}

/** Streams speech as raw 24 kHz 16-bit PCM. */
export async function speechStream(
  apiKey: string,
  text: string,
  voice: VoiceSettings,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const query = new URLSearchParams({ output_format: "pcm_24000" });
  const res = await check(
    await send(`${API}/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}/stream?${query}`, {
      method: "POST",
      signal,
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: voice.model,
        voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, voice.speed)) },
      }),
    }),
    "speech",
  );
  if (!res.body) throw new ElevenLabsError("ElevenLabs returned no audio.");
  return res.body;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

export async function listVoices(apiKey: string): Promise<VoiceInfo[]> {
  const res = await check(await send(`${API}/v1/voices`, { headers: { "xi-api-key": apiKey } }), "voice list");
  return ((await res.json()) as { voices?: VoiceInfo[] }).voices ?? [];
}

/** Float32 samples (-1..1) to little-endian 16-bit PCM, base64-encoded. */
export function floatToPcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Little-endian 16-bit PCM bytes to Float32 samples (-1..1). */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const count = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}
