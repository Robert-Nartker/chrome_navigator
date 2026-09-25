// Speech-to-text with ElevenLabs Scribe v2 Realtime: mic -> 16 kHz PCM -> WebSocket.
// Only speech is sent: a small local voice detector opens the connection when you start
// talking and closes it after a few quiet seconds, so you pay for seconds of speech rather
// than for the whole time the mic is on. Server-side turn detection ends each utterance,
// and background-speech filtering ignores nearby conversations.

import { ElevenLabsError, floatToPcm16Base64, realtimeToken, scribeUrl } from "./elevenlabs";
import { type SpeechCallbacks, type SpeechEngine, openCleanMic } from "./speech";

export interface ScribeEngineOptions {
  apiKey: string;
  lang: string;
  keyterms: string[];
  filterBackgroundAudio: boolean;
  /** While true (e.g. Navi is talking), nothing is sent, so Navi never transcribes itself. */
  isMuted: () => boolean;
}

/** Audio arrives in 100 ms chunks (see pcm-worklet). */
const CHUNK_MS = 100;
/** Audio kept from just before speech starts, so the first syllable isn't cut off. */
const PRE_ROLL_CHUNKS = 5;
/** Loud chunks in a row that count as speech starting. */
const ONSET_CHUNKS = 2;
/** Keep sending this long after speech stops, so the server hears the pause that ends the phrase. */
const HANGOVER_MS = 1500;
/** Close the connection after this long without speech. */
const IDLE_CLOSE_MS = 8000;
/** A "voice" longer than this is probably steady noise (music, a fan): stop and relearn the noise level. */
const MAX_SPEECH_MS = 30_000;

/**
 * Energy-based voice detector: tracks the background level and flags chunks well above it.
 * Deliberately simple; ElevenLabs' own filtering sorts out background voices.
 */
export class VoiceDetector {
  private noise = 0.01;
  private loudRun = 0;
  private quietMs = 0;
  private speechMs = 0;
  speaking = false;

  /** Feeds one chunk; returns true while the chunk should be sent. */
  push(samples: Float32Array): boolean {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(samples.length, 1));
    const loud = rms > Math.max(0.015, this.noise * 2.5);
    if (!this.speaking) {
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (!loud) this.noise = this.noise * 0.95 + rms * 0.05;
      if (this.loudRun >= ONSET_CHUNKS) {
        this.speaking = true;
        this.quietMs = 0;
        this.speechMs = 0;
      }
      return this.speaking;
    }
    this.speechMs += CHUNK_MS;
    this.quietMs = loud ? 0 : this.quietMs + CHUNK_MS;
    if (this.quietMs >= HANGOVER_MS || this.speechMs >= MAX_SPEECH_MS) {
      if (this.speechMs >= MAX_SPEECH_MS) this.noise = Math.max(this.noise, rms);
      this.speaking = false;
      this.loudRun = 0;
    }
    return true;
  }
}

export class ScribeEngine implements SpeechEngine {
  readonly label = "ElevenLabs Scribe v2 Realtime";
  private wanted = false;
  /** False after a connection failure, until a connection works again; Chrome's recognizer covers meanwhile. */
  private healthy = true;
  private socket: WebSocket | null = null;
  private connecting = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private detector = new VoiceDetector();
  private preRoll: Float32Array[] = [];
  /** Speech captured while the connection opens. */
  private pending: Float32Array[] = [];
  private lastSpeech = 0;
  private idleTimer: number | undefined;

  constructor(
    private readonly options: ScribeEngineOptions,
    private readonly callbacks: SpeechCallbacks,
  ) {}

  get running() {
    return this.wanted;
  }

  /** True while this engine is the one transcribing (Chrome's recognizer defers to it). */
  get live(): boolean {
    return this.wanted && this.healthy;
  }

  async start() {
    this.wanted = true;
    try {
      await this.openAudio();
    } catch (err) {
      // Stopped while the mic was opening: not an error.
      if (!this.wanted) return;
      this.wanted = false;
      this.callbacks.onError(`Couldn't open the microphone: ${String(err)}`, true);
      return;
    }
    // stop() may have been called while the mic was opening.
    if (!this.wanted) return this.stop();
    this.callbacks.onRunningChange(true);
  }

  stop() {
    this.wanted = false;
    window.clearInterval(this.idleTimer);
    this.closeSocket();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.pending = [];
    this.preRoll = [];
    this.callbacks.onRunningChange(false);
  }

  private async openAudio() {
    const stream = await openCleanMic(true);
    this.stream = stream;
    // The AudioContext resamples the mic to 16 kHz for us.
    const context = new AudioContext({ sampleRate: 16000 });
    this.context = context;
    await context.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
    if (!this.wanted) throw new Error("stopped");
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "pcm-chunker");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.feed(event.data);
    source.connect(node);
    // Keep the graph pulling audio without playing the mic back.
    const silent = context.createGain();
    silent.gain.value = 0;
    node.connect(silent).connect(context.destination);
    this.idleTimer = window.setInterval(() => {
      if (this.socket && !this.detector.speaking && Date.now() - this.lastSpeech > IDLE_CLOSE_MS) this.closeSocket();
    }, 1000);
  }

  /** Takes one 100 ms chunk of 16 kHz mic audio (public so tests can feed audio directly). */
  feed(samples: Float32Array) {
    if (!this.wanted) return;
    // While Navi is talking, treat everything as silence so it never hears itself.
    const send = this.options.isMuted() ? false : this.detector.push(samples);
    if (!send) {
      this.preRoll.push(samples);
      if (this.preRoll.length > PRE_ROLL_CHUNKS) this.preRoll.shift();
      return;
    }
    this.lastSpeech = Date.now();
    const chunks = this.preRoll.length ? [...this.preRoll.splice(0), samples] : [samples];
    if (this.socket?.readyState === WebSocket.OPEN) {
      for (const c of chunks) this.send(c);
      return;
    }
    this.pending.push(...chunks);
    // Cap what's held while connecting (about 10 s).
    if (this.pending.length > 100) this.pending.splice(0, this.pending.length - 100);
    void this.connect();
  }

  private send(chunk: Float32Array) {
    this.socket?.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: floatToPcm16Base64(chunk),
        commit: false,
        sample_rate: 16000,
      }),
    );
  }

  private async connect() {
    if (this.connecting || this.socket || !this.wanted) return;
    this.connecting = true;
    let token: string;
    try {
      token = await realtimeToken(this.options.apiKey);
    } catch (err) {
      this.connecting = false;
      this.pending = [];
      const fatal = err instanceof ElevenLabsError && err.status === 401;
      this.healthy = false;
      this.callbacks.onError(err instanceof Error ? err.message : String(err), fatal);
      if (fatal) this.stop();
      return;
    }
    if (!this.wanted) {
      this.connecting = false;
      return;
    }
    const socket = new WebSocket(
      scribeUrl({
        token,
        languageCode: this.options.lang,
        keyterms: this.options.keyterms,
        filterBackgroundAudio: this.options.filterBackgroundAudio,
        silenceSecs: 0.6,
      }),
    );
    this.socket = socket;
    socket.onopen = () => {
      this.connecting = false;
      // After a failure, Chrome's recognizer already handled the held speech: don't run it twice.
      const recovered = !this.healthy;
      this.healthy = true;
      const held = this.pending.splice(0);
      if (!recovered) for (const c of held) this.send(c);
    };
    socket.onmessage = (event) => this.onMessage(String(event.data));
    socket.onerror = () => {
      this.healthy = false;
    };
    socket.onclose = () => {
      this.connecting = false;
      if (this.socket === socket) this.socket = null;
    };
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    this.connecting = false;
    socket?.close();
  }

  private onMessage(raw: string) {
    let data: { message_type?: string; text?: string; error?: string; message?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    switch (data.message_type) {
      case "partial_transcript":
        this.callbacks.onInterim(data.text ?? "");
        return;
      case "committed_transcript":
        this.callbacks.onInterim("");
        if (data.text?.trim()) this.callbacks.onFinal(data.text.trim(), 0);
        return;
      case "auth_error":
        this.callbacks.onError("ElevenLabs rejected the API key. Check it in Navi's settings.", true);
        this.stop();
        return;
      case "quota_exceeded":
        this.callbacks.onError("ElevenLabs quota used up. Switching back to Chrome's speech recognition.", true);
        this.stop();
        return;
      case "session_time_limit_exceeded":
        // Long sessions are capped; the next speech opens a new one.
        this.closeSocket();
        return;
      case "error":
      case "transcriber_error":
      case "input_error":
      case "invalid_request":
        this.callbacks.onError(`Speech service: ${data.error ?? data.message ?? data.message_type}`, false);
        return;
    }
  }
}
