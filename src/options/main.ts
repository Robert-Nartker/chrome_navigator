import { clearMetrics, loadMetrics, summarize, toCsv } from "../lib/metrics";
import { MODELS, type Settings, loadSettings, saveSettings } from "../lib/settings";

const form = document.getElementById("settings") as HTMLFormElement;
const saved = document.getElementById("saved") as HTMLElement;
const field = <T extends HTMLElement>(id: keyof Settings) => document.getElementById(id) as T;

const modelSelect = field<HTMLSelectElement>("model");
for (const m of MODELS) modelSelect.add(new Option(m.label, m.id));

chrome.tts.getVoices((voices) => {
  const select = field<HTMLSelectElement>("voiceName");
  const current = select.dataset.value ?? "";
  for (const v of voices) {
    if (v.voiceName) select.add(new Option(`${v.voiceName}${v.lang ? ` (${v.lang})` : ""}`, v.voiceName));
  }
  select.value = current;
});

async function fill() {
  const s = await loadSettings();
  field<HTMLInputElement>("apiKey").value = s.apiKey;
  modelSelect.value = s.model;
  field<HTMLSelectElement>("effort").value = s.effort;
  field<HTMLInputElement>("fastMode").checked = s.fastMode;
  field<HTMLInputElement>("maxAgentSteps").value = String(s.maxAgentSteps);
  field<HTMLInputElement>("wakeName").value = s.wakeName;
  field<HTMLSelectElement>("listenMode").value = s.listenMode;
  field<HTMLInputElement>("sessionTimeoutSec").value = String(s.sessionTimeoutSec);
  field<HTMLInputElement>("lang").value = s.lang;
  field<HTMLSelectElement>("feedback").value = s.feedback;
  const voice = field<HTMLSelectElement>("voiceName");
  voice.dataset.value = s.voiceName;
  voice.value = s.voiceName;
  field<HTMLInputElement>("speechRate").value = String(s.speechRate);
  field<HTMLInputElement>("allowPageText").checked = s.allowPageText;
  field<HTMLInputElement>("allowCloudSpeech").checked = s.allowCloudSpeech;
  field<HTMLTextAreaElement>("blockedSites").value = s.blockedSites.join("\n");
}

function clamp(value: string, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings({
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    model: modelSelect.value,
    effort: field<HTMLSelectElement>("effort").value as Settings["effort"],
    fastMode: field<HTMLInputElement>("fastMode").checked,
    maxAgentSteps: clamp(field<HTMLInputElement>("maxAgentSteps").value, 1, 30, 12),
    wakeName: field<HTMLInputElement>("wakeName").value.trim() || "Navi",
    listenMode: field<HTMLSelectElement>("listenMode").value as Settings["listenMode"],
    sessionTimeoutSec: clamp(field<HTMLInputElement>("sessionTimeoutSec").value, 10, 1800, 120),
    lang: field<HTMLInputElement>("lang").value.trim() || "en-US",
    feedback: field<HTMLSelectElement>("feedback").value as Settings["feedback"],
    voiceName: field<HTMLSelectElement>("voiceName").value,
    speechRate: clamp(field<HTMLInputElement>("speechRate").value, 0.5, 3, 1.1),
    allowPageText: field<HTMLInputElement>("allowPageText").checked,
    allowCloudSpeech: field<HTMLInputElement>("allowCloudSpeech").checked,
    blockedSites: field<HTMLTextAreaElement>("blockedSites")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  saved.textContent = "Saved";
  window.setTimeout(() => (saved.textContent = ""), 2000);
});

void fill();

const metricsSummary = document.getElementById("metrics-summary") as HTMLElement;

async function showMetrics() {
  const m = summarize(await loadMetrics());
  metricsSummary.textContent = m.total
    ? `${m.total} commands: ${m.fast} fast path (median ${m.fastMedianMs} ms), ${m.ai} AI (median ${(m.aiMedianMs / 1000).toFixed(1)} s, ${m.aiMedianSteps} steps), ${m.errors} errors.`
    : "No commands logged yet.";
}

document.getElementById("export-metrics")?.addEventListener("click", async () => {
  const blob = new Blob([toCsv(await loadMetrics())], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `navi-usage-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("clear-metrics")?.addEventListener("click", async () => {
  if (!confirm("Clear the usage log?")) return;
  await clearMetrics();
  await showMetrics();
});

void showMetrics();
