import { installOnDevice, onDeviceStatus } from "../lib/speech";
import { loadSettings } from "../lib/settings";

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
