// Navi Free's model: Chrome's built-in Gemini Nano, on this computer (the Prompt API). Chrome only
// offers it to pages, so it runs in Navi's background page (offscreen document); the worker reaches
// it through a transport set up at startup (see background/navi.ts). The setup and settings pages
// use it directly to check it and download it.

/** "unsupported": this Chrome has no on-device model at all. */
export type NanoStatus = "available" | "downloadable" | "downloading" | "unavailable" | "unsupported";

export interface NanoRequest {
  /** Instructions (sent once per session; sessions are reused per instruction text). */
  system: string;
  text: string;
  /** JSON Schema the answer must follow. */
  schema?: object;
  /** A JPEG data URL (e.g. a screenshot) to look at along with the text. */
  image?: string;
}

/** What each status means for the user, and what to do. */
export const NANO_STATUS_TEXT: Record<NanoStatus, string> = {
  available: "Ready on this computer.",
  downloadable: "Needs a one-time download (about 4 GB).",
  downloading: "Downloading…",
  unavailable: "This computer can't run it: it needs about 16 GB of memory or a graphics card with 4 GB, and 22 GB of free disk space.",
  unsupported: "This version of Chrome doesn't include it (Chrome 138 or newer on Windows, macOS, Linux or a Chromebook Plus).",
};

// ---------- In the worker: requests go to the background page ----------

interface NanoTransport {
  prompt(req: NanoRequest): Promise<string>;
  status(): Promise<NanoStatus>;
}

let transport: NanoTransport | null = null;

export function setNanoTransport(t: NanoTransport) {
  transport = t;
}

export function askNano(req: NanoRequest): Promise<string> {
  if (!transport) return Promise.reject(new Error("Navi's on-device model isn't set up here."));
  return transport.prompt(req);
}

export function nanoStatusRemote(): Promise<NanoStatus> {
  return transport ? transport.status() : Promise.resolve("unsupported");
}

// ---------- In a page: Chrome's Prompt API ----------

/** The bits of Chrome's Prompt API Navi uses (TypeScript's DOM types don't have it yet). */
interface LanguageModelSession {
  prompt(input: unknown, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  clone(): Promise<LanguageModelSession>;
  destroy(): void;
}
interface LanguageModelApi {
  availability(options?: object): Promise<Exclude<NanoStatus, "unsupported">>;
  create(options?: object): Promise<LanguageModelSession>;
}

const api = () => (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;

const OPTIONS = (image: boolean) => ({
  expectedInputs: [{ type: "text", languages: ["en"] }, ...(image ? [{ type: "image" }] : [])],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
});

export async function nanoStatus(): Promise<NanoStatus> {
  const lm = api();
  if (!lm) return "unsupported";
  try {
    return await lm.availability(OPTIONS(true));
  } catch {
    return "unavailable";
  }
}

/** Starts (or finishes) the one-time model download; needs a click on the page that calls it. */
export async function downloadNano(onProgress?: (fraction: number) => void): Promise<void> {
  const lm = api();
  if (!lm) throw new Error(NANO_STATUS_TEXT.unsupported);
  const session = await lm.create({
    ...OPTIONS(true),
    monitor(m: EventTarget) {
      m.addEventListener("downloadprogress", (e) => onProgress?.((e as ProgressEvent).loaded));
    },
  });
  session.destroy();
}

/** A ready session per instruction text; each request runs on a copy, so requests don't pile up history. */
const sessions = new Map<string, Promise<LanguageModelSession>>();

export async function runNano(req: NanoRequest): Promise<string> {
  const lm = api();
  if (!lm) throw new Error(NANO_STATUS_TEXT.unsupported);
  const status = await nanoStatus();
  if (status !== "available") throw new Error(`Navi Free's on-device AI isn't ready. ${NANO_STATUS_TEXT[status]}`);
  const key = `${req.image ? "image" : "text"}\n${req.system}`;
  let base = sessions.get(key);
  if (!base) {
    base = lm.create({ ...OPTIONS(!!req.image), initialPrompts: [{ role: "system", content: req.system }] });
    sessions.set(key, base);
    base.catch(() => sessions.delete(key));
  }
  const session = await (await base).clone();
  try {
    const input = req.image
      ? [
          {
            role: "user",
            content: [
              { type: "text", value: req.text },
              { type: "image", value: await (await fetch(req.image)).blob() },
            ],
          },
        ]
      : req.text;
    return await session.prompt(input, req.schema ? { responseConstraint: req.schema } : undefined);
  } finally {
    session.destroy();
  }
}
