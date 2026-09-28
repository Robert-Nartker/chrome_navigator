import { type Step, deleteCommand, describeCommand, loadCommands, onCommandsChanged, saveCommand } from "../lib/custom-commands";
import { clearMetrics, loadMetrics, summarize, toCsv } from "../lib/metrics";
import { DEFAULT_VOICE_ID, TTS_MODELS, listVoices as listElevenVoices } from "../lib/elevenlabs";
import { MODEL_CATALOG, PROVIDER_DEFAULTS, type Provider, formatCost, modelInfo } from "../lib/models";
import { DEFAULT_SETTINGS, type Settings, loadSettings, saveSettings, withAvailableModels } from "../lib/settings";
import { Speaker, pickVoice } from "../lib/voice-output";

const form = document.getElementById("settings") as HTMLFormElement;
const saved = document.getElementById("saved") as HTMLElement;
const field = <T extends HTMLElement>(id: keyof Settings) => document.getElementById(id) as T;

const modelSelect = field<HTMLSelectElement>("model");
const routerSelect = field<HTMLSelectElement>("routerModel");
const price = (m: (typeof MODEL_CATALOG)[number]) => `$${m.price.input} / $${m.price.output} per M tokens`;
for (const m of MODEL_CATALOG.filter((x) => x.roles.includes("agent"))) {
  modelSelect.add(new Option(`${m.label} (${price(m)})`, m.id));
}
// Quick-check models: each provider's default first.
const routerIds = [PROVIDER_DEFAULTS.openai.routerModel, PROVIDER_DEFAULTS.anthropic.routerModel];
const routers = MODEL_CATALOG.filter((x) => x.roles.includes("router")).sort(
  (a, b) => (routerIds.indexOf(a.id) + 1 || 99) - (routerIds.indexOf(b.id) + 1 || 99),
);
for (const m of routers) {
  routerSelect.add(new Option(`Quick check with ${m.label} first (${price(m)})`, m.id));
}
routerSelect.add(new Option("Send straight to the main model", "off"));

/** Fills in a provider's recommended models (saved with the rest of the form). */
function usePreset(provider: Provider) {
  const preset = PROVIDER_DEFAULTS[provider];
  modelSelect.value = preset.model;
  routerSelect.value = preset.routerModel;
  field<HTMLSelectElement>("effort").value = preset.effort;
  saved.textContent = `${preset.name} setup chosen. Save to keep it.`;
  updateModelNote();
}
document.getElementById("preset-openai")!.addEventListener("click", () => usePreset("openai"));
document.getElementById("preset-anthropic")!.addEventListener("click", () => usePreset("anthropic"));

/** Says when a chosen model can't run for lack of its key, and what Navi uses instead. */
function updateModelNote() {
  const note = document.getElementById("model-note")!;
  const chosen = {
    ...DEFAULT_SETTINGS,
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    openaiKey: field<HTMLInputElement>("openaiKey").value.trim(),
    model: modelSelect.value,
    routerModel: routerSelect.value,
  };
  const used = withAvailableModels(chosen);
  const swaps: string[] = [];
  if (used.model !== chosen.model) swaps.push(`${modelInfo(used.model).label} for tasks`);
  if (used.routerModel !== chosen.routerModel) swaps.push(`${modelInfo(used.routerModel).label} for quick checks`);
  note.hidden = !swaps.length;
  note.textContent = swaps.length ? `No key for the models chosen above, so Navi uses ${swaps.join(" and ")}.` : "";
}
for (const id of ["apiKey", "openaiKey", "model", "routerModel"] as const) {
  field<HTMLElement>(id).addEventListener("input", updateModelNote);
  field<HTMLElement>(id).addEventListener("change", updateModelNote);
}

/** Keeps a stored model that isn't in the menus (e.g. an older default) selectable. */
function selectValue(select: HTMLSelectElement, value: string) {
  if (![...select.options].some((o) => o.value === value)) select.add(new Option(value, value));
  select.value = value;
}
for (const m of TTS_MODELS) field<HTMLSelectElement>("elevenModel").add(new Option(m.label, m.id));

const elevenVoice = field<HTMLSelectElement>("elevenVoiceId");
let loadedVoicesFor = "";

/** Fills the ElevenLabs voice list from the account (premade voices plus any you've added). */
async function loadElevenVoices() {
  const key = field<HTMLInputElement>("elevenLabsKey").value.trim();
  if (!key || key === loadedVoicesFor) return;
  loadedVoicesFor = key;
  const current = elevenVoice.value || DEFAULT_VOICE_ID;
  try {
    const voices = await listElevenVoices(key);
    if (!voices.length) return;
    elevenVoice.replaceChildren();
    for (const v of voices) {
      const traits = [v.labels?.gender, v.labels?.accent, v.labels?.description ?? v.labels?.descriptive]
        .filter(Boolean)
        .join(", ");
      elevenVoice.add(new Option(traits ? `${v.name} (${traits})` : v.name, v.voice_id));
    }
    elevenVoice.value = voices.some((v) => v.voice_id === current) ? current : voices[0].voice_id;
  } catch (err) {
    loadedVoicesFor = "";
    saved.textContent = err instanceof Error ? err.message : String(err);
  }
}
field<HTMLInputElement>("elevenLabsKey").addEventListener("change", () => void loadElevenVoices());

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
  field<HTMLInputElement>("openaiKey").value = s.openaiKey;
  selectValue(modelSelect, s.model);
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
  field<HTMLInputElement>("volume").value = String(s.volume);
  selectValue(routerSelect, s.routerModel);
  field<HTMLInputElement>("allowPageText").checked = s.allowPageText;
  field<HTMLInputElement>("allowCloudSpeech").checked = s.allowCloudSpeech;
  field<HTMLInputElement>("allowScreenshots").checked = s.allowScreenshots;
  field<HTMLInputElement>("typedPageContext").checked = s.typedPageContext;
  field<HTMLTextAreaElement>("blockedSites").value = s.blockedSites.join("\n");
  field<HTMLInputElement>("elevenLabsKey").value = s.elevenLabsKey;
  field<HTMLSelectElement>("speechInput").value = s.speechInput;
  field<HTMLSelectElement>("speechOutput").value = s.speechOutput;
  field<HTMLInputElement>("filterBackgroundAudio").checked = s.filterBackgroundAudio;
  field<HTMLSelectElement>("elevenModel").value = s.elevenModel;
  if (![...elevenVoice.options].some((o) => o.value === s.elevenVoiceId)) {
    elevenVoice.add(new Option(s.elevenVoiceId, s.elevenVoiceId));
  }
  elevenVoice.value = s.elevenVoiceId;
  void loadElevenVoices();
  updateModelNote();
}

function clamp(value: string, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings({
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    openaiKey: field<HTMLInputElement>("openaiKey").value.trim(),
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
    speechRate: clamp(field<HTMLInputElement>("speechRate").value, 0.5, 3, 1),
    volume: clamp(field<HTMLInputElement>("volume").value, 0, 1, 0.6),
    routerModel: routerSelect.value,
    allowPageText: field<HTMLInputElement>("allowPageText").checked,
    allowCloudSpeech: field<HTMLInputElement>("allowCloudSpeech").checked,
    allowScreenshots: field<HTMLInputElement>("allowScreenshots").checked,
    typedPageContext: field<HTMLInputElement>("typedPageContext").checked,
    blockedSites: field<HTMLTextAreaElement>("blockedSites")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    elevenLabsKey: field<HTMLInputElement>("elevenLabsKey").value.trim(),
    speechInput: field<HTMLSelectElement>("speechInput").value as Settings["speechInput"],
    speechOutput: field<HTMLSelectElement>("speechOutput").value as Settings["speechOutput"],
    filterBackgroundAudio: field<HTMLInputElement>("filterBackgroundAudio").checked,
    elevenVoiceId: elevenVoice.value || DEFAULT_VOICE_ID,
    elevenModel: field<HTMLSelectElement>("elevenModel").value,
  });
  saved.textContent = "Saved";
  window.setTimeout(() => (saved.textContent = ""), 2000);
});

void fill();

const metricsSummary = document.getElementById("metrics-summary") as HTMLElement;

async function showMetrics() {
  const m = summarize(await loadMetrics());
  metricsSummary.textContent = m.total
    ? `${m.total} commands: ${m.fast} fast path (median ${m.fastMedianMs} ms), ${m.ai} AI (median ${(m.aiMedianMs / 1000).toFixed(1)} s, ${m.aiMedianSteps} steps), ${m.errors} errors. AI cost so far: ${formatCost(m.costUsd)}.`
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

const commandList = document.getElementById("commands") as HTMLUListElement;
const cmdResult = document.getElementById("cmd-result") as HTMLElement;

async function showCommands() {
  const commands = await loadCommands();
  commandList.replaceChildren();
  if (!commands.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No commands yet.";
    commandList.append(li);
    return;
  }
  for (const command of commands) {
    const li = document.createElement("li");
    const what = document.createElement("span");
    what.className = "what";
    what.textContent = describeCommand(command);
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete command ${command.phrases[0]}`);
    del.addEventListener("click", async () => {
      await deleteCommand(command.id);
      await showCommands();
    });
    li.append(what, del);
    commandList.append(li);
  }
}

document.getElementById("cmd-add")?.addEventListener("click", async () => {
  const phrases = (document.getElementById("cmd-phrases") as HTMLInputElement).value.split(",");
  const type = (document.getElementById("cmd-type") as HTMLSelectElement).value;
  const value = (document.getElementById("cmd-value") as HTMLTextAreaElement).value;
  const steps: Step[] =
    type === "open"
      ? [{ type: "open", url: value.trim(), newTab: false }]
      : value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((command) => ({ type: "run", command }));
  try {
    const { command } = await saveCommand({ phrases, steps });
    cmdResult.className = "ok";
    cmdResult.textContent = `Saved ${describeCommand(command)}`;
    (document.getElementById("cmd-phrases") as HTMLInputElement).value = "";
    (document.getElementById("cmd-value") as HTMLTextAreaElement).value = "";
  } catch (err) {
    cmdResult.className = "err";
    cmdResult.textContent = err instanceof Error ? err.message : String(err);
  }
  await showCommands();
});

onCommandsChanged(() => void showCommands());
void showCommands();

document.getElementById("test-voice")?.addEventListener("click", async () => {
  const voiceName = field<HTMLSelectElement>("voiceName").value;
  const lang = field<HTMLInputElement>("lang").value || "en-US";
  const apiKey = field<HTMLInputElement>("elevenLabsKey").value.trim();
  const useEleven = !!apiKey && field<HTMLSelectElement>("speechOutput").value === "elevenlabs";
  const speaker = new Speaker(
    () => ({
      voiceName,
      lang,
      rate: Number(field<HTMLInputElement>("speechRate").value) || 1,
      volume: Number(field<HTMLInputElement>("volume").value),
      eleven: useEleven
        ? { apiKey, voiceId: elevenVoice.value || DEFAULT_VOICE_ID, model: field<HTMLSelectElement>("elevenModel").value }
        : undefined,
    }),
    (message) => (saved.textContent = `${message} Falling back to Chrome's voice.`),
  );
  const name = useEleven
    ? (elevenVoice.selectedOptions[0]?.text.split(" (")[0] ?? "an ElevenLabs voice")
    : voiceName || (await pickVoice(lang)) || "the default voice";
  await speaker.say(`Hi, I'm Navi. This is ${name}.`);
});
