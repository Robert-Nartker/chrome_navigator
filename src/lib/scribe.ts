// Speech-to-text with ElevenLabs Scribe v2 Realtime: mic -> 16 kHz PCM -> WebSocket.
// Server-side voice activity detection ends each utterance, background-speech filtering
// ignores nearby conversations, and keyterms bias toward site names and the wake name.

import { ElevenLabsError, floatToPcm16Base64, realtimeToken, scribeUrl } from "./elevenlabs";
import { type SpeechCallbacks, type SpeechEngine, openCleanMic } from "./speech";

export interface ScribeEngineOptions {
  apiKey: string;
  lang: string;
  keyterms: string[];
  filterBackgroundAudio: boolean;
  /** While true (e.g. Navi is talking), audio isn't sent, so Navi never transcribes itself. */
  isMuted: () => boolean;
}

/** How long Chrome's recognizer waits for the first ElevenLabs connection before taking over. */
const GRACE_MS = 4000;

export class ScribeEngine implements SpeechEngine {
  readonly label = "ElevenLabs Scribe v2 Realtime";
  private wanted = false;
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private retryDelay = 500;
  private retryTimer: number | undefined;
  private pending: { at: number; chunk: Float32Array }[] = [];
  private startedAt = 0;
  private everOpened = false;

  constructor(
    private readonly options: ScribeEngineOptions,
    private readonly callbacks: SpeechCallbacks,
  ) {}

  get running() {
    return this.wanted;
  }

  /**
   * True while this engine is (or is about to be) transcribing: connected, or still within
   * the first connection's grace period. While reconnecting, Chrome's recognizer takes over.
   */
  get live(): boolean {
    if (!this.wanted) return false;
    if (this.socket?.readyState === WebSocket.OPEN) return true;
    return !this.everOpened && Date.now() - this.startedAt < GRACE_MS;
  }

  async start() {
    this.wanted = true;
    this.startedAt = Date.now();
    try {
      await this.openAudio();
    } catch (err) {
      this.wanted = false;
      this.callbacks.onError(`Couldn't open the microphone: ${String(err)}`, true);
      return;
    }
    // stop() may have been called while the mic was opening.
    if (!this.wanted) return this.stop();
    await this.connect();
  }

  stop() {
    this.wanted = false;
    window.clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.pending = [];
    this.callbacks.onRunningChange(false);
  }

  private async openAudio() {
    this.stream = await openCleanMic();
    // The AudioContext resamples the mic to 16 kHz for us.
    this.context = new AudioContext({ sampleRate: 16000 });
    await this.context.audioWorklet.addModule(chrome.runtime.getURL("pcm-worklet.js"));
    const source = this.context.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.context, "pcm-chunker");
    node.port.onmessage = (event: MessageEvent<Float32Array>) => this.sendAudio(event.data);
    source.connect(node);
    // Keep the graph pulling audio without playing the mic back.
    const silent = this.context.createGain();
    silent.gain.value = 0;
    node.connect(silent).connect(this.context.destination);
  }

  private sendAudio(samples: Float32Array) {
    // While Navi is talking, send silence so turn detection keeps working without hearing Navi.
    const chunk = this.options.isMuted() ? new Float32Array(samples.length) : samples;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      // Hold audio during the first connection, so a command said right after "Hey Navi" isn't lost.
      if (!this.everOpened) {
        this.pending.push({ at: Date.now(), chunk });
        if (this.pending.length > 50) this.pending.shift();
      }
      return;
    }
    this.send(chunk);
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

  /**
   * Sends audio held while connecting. Past the grace period Chrome's recognizer has already
   * handled that speech, so it's dropped rather than run twice.
   */
  private flushPending() {
    if (!this.everOpened && Date.now() - this.startedAt < GRACE_MS) {
      for (const { chunk } of this.pending) this.send(chunk);
    }
    this.pending = [];
    this.everOpened = true;
  }

  private async connect() {
    if (!this.wanted) return;
    let token: string;
    try {
      token = await realtimeToken(this.options.apiKey);
    } catch (err) {
      const fatal = err instanceof ElevenLabsError && err.status === 401;
      this.callbacks.onError(err instanceof Error ? err.message : String(err), fatal);
      if (fatal) return this.stop();
      return this.scheduleReconnect();
    }
    if (!this.wanted) return;
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
      this.retryDelay = 500;
      this.flushPending();
      this.callbacks.onRunningChange(true);
    };
    socket.onmessage = (event) => this.onMessage(String(event.data));
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.wanted) this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => void this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
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
        // Long sessions are capped; just reconnect.
        this.socket?.close();
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
