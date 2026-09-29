import { checkKey, providerOfKey } from "../lib/keys";
import { NANO_STATUS_TEXT, downloadNano, nanoStatus } from "../lib/nano";
import { PROVIDER_DEFAULTS, type ApiProvider, modelInfo } from "../lib/models";
import { activeSettings, aiModeOf, loadSettings, providersWithKeys, saveSettings } from "../lib/settings";
import { installOnDevice, onDeviceStatus } from "../lib/speech";

// One-time microphone permission. Extension side panels can't show Chrome's
// permission prompt, so it is granted here in a normal tab.

const grant = document.getElementById("grant") as HTMLButtonElement;
const result = document.getElementById("mic-result") as HTMLElement;
const level = document.getElementById("level") as HTMLElement;

function showLevel(stream: MediaStream) {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const started = performance.now();
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    level.style.width = `${Math.min(100, (peak / 64) * 100)}%`;
    if (performance.now() - started < 8000) requestAnimationFrame(tick);
    else {
      stream.getTracks().forEach((t) => t.stop());
      level.style.width = "0";
      void ctx.close();
    }
  };
  tick();
}

async function requestMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    result.className = "ok";
    result.textContent = "Microphone allowed. Say something to test it, then open Navi.";
    grant.textContent = "Allowed";
    grant.disabled = true;
    showLevel(stream);
    void chrome.runtime.sendMessage({ type: "navi:mic-granted" }).catch(() => undefined);
  } catch (err) {
    result.className = "err";
    const name = err instanceof DOMException ? err.name : "";
    result.textContent =
      name === "NotAllowedError"
        ? "Microphone was blocked. Click the icon at the right of the address bar to allow it, then try again."
        : name === "NotFoundError"
          ? "No microphone found. Plug one in and try again."
          : `Couldn't open the microphone: ${String(err)}`;
  }
}

grant.addEventListener("click", () => void requestMic());

void navigator.permissions
  .query({ name: "microphone" as PermissionName })
  .then((status) => {
    if (status.state === "granted") {
      result.className = "ok";
      result.textContent = "Microphone already allowed.";
      grant.textContent = "Test microphone";
    }
  })
  .catch(() => undefined);

const onDeviceButton = document.getElementById("ondevice") as HTMLButtonElement;
const onDeviceResult = document.getElementById("ondevice-result") as HTMLElement;

async function showOnDevice() {
  const { lang } = await loadSettings();
  const status = await onDeviceStatus(lang);
  onDeviceResult.className = status === "available" ? "ok" : "";
  onDeviceButton.disabled = status !== "downloadable";
  onDeviceResult.textContent = {
    available: "On-device speech is ready. Audio stays on this computer.",
    downloadable: "Available for your language. Click to download (a one-time download).",
    downloading: "Downloading…",
    unavailable: `On-device speech isn't available for ${lang} on this computer. Navi will use Google's speech service.`,
    unsupported: "This version of Chrome doesn't support on-device speech (needs Chrome 139+). Navi will use Google's speech service.",
  }[status];
  if (status === "downloading") window.setTimeout(() => void showOnDevice(), 3000);
}

onDeviceButton.addEventListener("click", async () => {
  const { lang } = await loadSettings();
  onDeviceButton.disabled = true;
  onDeviceResult.textContent = "Downloading…";
  try {
    await installOnDevice(lang);
  } catch (err) {
    onDeviceResult.className = "err";
    onDeviceResult.textContent = `Download failed: ${String(err)}`;
    return;
  }
  await showOnDevice();
});

void showOnDevice();

// ---------- Connect an AI ----------

const providerRadios = [...document.querySelectorAll<HTMLInputElement>("input[name=provider]")];
const keyInput = document.getElementById("ai-key") as HTMLInputElement;
const keyLabel = document.getElementById("ai-key-label") as HTMLElement;
const getKey = document.getElementById("ai-get-key") as HTMLAnchorElement;
const connect = document.getElementById("ai-connect") as HTMLButtonElement;
const aiResult = document.getElementById("ai-result") as HTMLElement;
const aiWarning = document.getElementById("ai-warning") as HTMLElement;

const PROVIDER_PAGES: Record<ApiProvider, { name: string; placeholder: string; keysUrl: string }> = {
  openai: { name: "OpenAI", placeholder: "sk-…", keysUrl: "https://platform.openai.com/api-keys" },
  anthropic: { name: "Anthropic", placeholder: "sk-ant-…", keysUrl: "https://console.anthropic.com/settings/keys" },
};

const chosenProvider = () => (providerRadios.find((r) => r.checked)?.value ?? "openai") as ApiProvider;

function showProvider(provider: ApiProvider) {
  const page = PROVIDER_PAGES[provider];
  for (const r of providerRadios) r.checked = r.value === provider;
  keyLabel.textContent = `${page.name} API key`;
  keyInput.placeholder = page.placeholder;
  getKey.href = page.keysUrl;
  getKey.textContent = `Get an ${page.name} key`;
  getKey.nextSibling!.textContent = `. It's stored only in this browser profile and sent only to ${page.name}.`;
}

/** What Navi will run with this provider, in a line. */
function describeSetup(provider: ApiProvider): string {
  const d = PROVIDER_DEFAULTS[provider];
  return `Tasks and chat: ${modelInfo(d.model).label} (low reasoning). Unclear speech: ${modelInfo(d.routerModel).label} (no reasoning).`;
}

function showConnected(provider: ApiProvider, lead: string) {
  aiResult.className = "ok";
  aiResult.replaceChildren(lead, Object.assign(document.createElement("span"), { className: "models", textContent: describeSetup(provider) }));
}

for (const r of providerRadios) r.addEventListener("change", () => showProvider(chosenProvider()));

keyInput.addEventListener("input", () => {
  // A pasted key usually says whose it is.
  const detected = providerOfKey(keyInput.value.trim());
  if (detected && detected !== chosenProvider()) showProvider(detected);
});
keyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void connectKey();
});
connect.addEventListener("click", () => void connectKey());

async function connectKey() {
  const provider = chosenProvider();
  const key = keyInput.value.trim();
  aiWarning.hidden = true;
  if (!key) {
    aiResult.className = "err";
    aiResult.textContent = `Paste your ${PROVIDER_PAGES[provider].name} API key first.`;
    keyInput.focus();
    return;
  }
  connect.disabled = true;
  aiResult.className = "";
  aiResult.textContent = "Checking the key…";
  const defaults = PROVIDER_DEFAULTS[provider];
  const check = await checkKey(provider, key, [...new Set([defaults.model, defaults.routerModel])]);
  connect.disabled = false;
  if (!check.ok) {
    aiResult.className = "err";
    aiResult.textContent = check.message;
    return;
  }
  // This provider's recommended models; upgrades and mixing providers are in settings.
  await saveSettings({
    [provider === "openai" ? "openaiKey" : "apiKey"]: key,
    aiMode: "pro",
    model: defaults.model,
    effort: defaults.effort,
    routerModel: defaults.routerModel,
  });
  keyInput.value = "";
  keyInput.placeholder = "Connected. Paste a new key to replace it.";
  showConnected(provider, `Connected to ${PROVIDER_PAGES[provider].name}. Navi Pro is on.`);
  void showFree();
  if (check.missing.length) {
    aiWarning.hidden = false;
    aiWarning.textContent = `Your account doesn't list ${check.missing.join(" or ")} yet. Navi will still try it; if it fails, check model access at ${PROVIDER_PAGES[provider].name}.`;
  }
}

async function showSavedKeys() {
  const s = await loadSettings();
  const have = providersWithKeys(s);
  const running = modelInfo(activeSettings({ ...s, aiMode: "pro" }).model).provider;
  const provider = have.find((p) => p === running) ?? have[0];
  if (!provider) return;
  showProvider(provider);
  keyInput.placeholder = "Connected. Paste a new key to replace it.";
  const others = have.filter((p) => p !== provider).map((p) => PROVIDER_PAGES[p].name);
  showConnected(provider, `Connected to ${PROVIDER_PAGES[provider].name}${others.length ? ` (and ${others.join(", ")})` : ""}.`);
  const used = activeSettings({ ...s, aiMode: "pro" });
  const d = PROVIDER_DEFAULTS[provider];
  if (used.model !== d.model || used.routerModel !== d.routerModel) {
    // Custom models chosen in settings: say what actually runs.
    aiResult.lastElementChild!.textContent = `Tasks and chat: ${modelInfo(used.model).label}. Unclear speech: ${
      used.routerModel === "off" ? "sent straight to the main model" : modelInfo(used.routerModel).label
    }.`;
  }
}

// ---------- Navi Free ----------

const useFree = document.getElementById("use-free") as HTMLButtonElement;
const freeResult = document.getElementById("free-result") as HTMLElement;

/** Whether Free is on, and whether this computer can run its on-device model. */
async function showFree() {
  const s = await loadSettings();
  const status = await nanoStatus();
  const on = aiModeOf(s) === "free";
  freeResult.className = on ? "hint ok" : "hint";
  freeResult.textContent = on
    ? `Navi Free is on. ${status === "available" ? "The on-device AI is ready." : `On-device AI: ${NANO_STATUS_TEXT[status]}${status === "downloadable" ? " Click the button to download it." : " Built-in commands still work."}`}`
    : `On-device AI: ${NANO_STATUS_TEXT[status]}`;
  useFree.textContent = on ? (status === "downloadable" ? "Download the on-device AI" : "Using Navi Free") : "Use Navi Free";
  useFree.disabled = on && status !== "downloadable";
}

useFree.addEventListener("click", async () => {
  useFree.disabled = true;
  let status = await nanoStatus();
  if (status === "downloadable" || status === "downloading") {
    freeResult.className = "hint";
    freeResult.textContent = "Downloading the on-device AI (about 4 GB, one time)…";
    try {
      await downloadNano((fraction) => (freeResult.textContent = `Downloading the on-device AI… ${Math.round(fraction * 100)}%`));
    } catch (err) {
      freeResult.textContent = `The download didn't start: ${err instanceof Error ? err.message : String(err)}`;
    }
    status = await nanoStatus();
  }
  // Free works without the model too (built-in commands only), so it's always the user's choice.
  await saveSettings({ aiMode: "free" });
  aiResult.textContent = "";
  await showFree();
});

void showFree();
void showSavedKeys();
if (location.hash === "#ai") {
  document.getElementById("ai")!.scrollIntoView({ block: "center" });
  keyInput.focus();
  // A tab that opened in the background takes focus when it's brought forward.
  if (!document.hasFocus()) window.addEventListener("focus", () => keyInput.focus(), { once: true });
}
