import { type Step, deleteCommand, describeCommand, loadCommands, onCommandsChanged, saveCommand } from "../lib/custom-commands";
import { MEMORY_CAP, clearMemory, loadMemory, onMemoryChanged, saveMemory } from "../lib/memory";
import { clearMetrics, loadMetrics, summarize, toCsv } from "../lib/metrics";
import { MODEL_CATALOG, PROVIDER_DEFAULTS, type ApiProvider, formatCost, modelInfo } from "../lib/models";
import { NANO_STATUS_TEXT, nanoStatus } from "../lib/nano";
import {
  type AiMode,
  DEFAULT_SETTINGS,
  type Settings,
  activeSettings,
  aiModeOf,
  loadSettings,
  loadStoredSettings,
  normalizeSettings,
  providersWithKeys,
  saveSettings,
} from "../lib/settings";
import { Speaker, pickVoice } from "../lib/voice-output";
import { KOKORO_VOICES } from "../tts-lab/kokoro-voices";

const form = document.getElementById("settings") as HTMLFormElement;
const saved = document.getElementById("saved") as HTMLElement;
const field = <T extends HTMLElement>(id: keyof Settings) => document.getElementById(id) as T;

const modelSelect = field<HTMLSelectElement>("model");
const helperSelect = field<HTMLSelectElement>("subagentModel");
const routerSelect = field<HTMLSelectElement>("routerModel");
const price = (m: (typeof MODEL_CATALOG)[number]) => `$${m.price.input} / $${m.price.output} per M tokens`;
for (const m of MODEL_CATALOG.filter((x) => x.roles.includes("agent"))) {
  modelSelect.add(new Option(`${m.label} (${price(m)})`, m.id));
  helperSelect.add(new Option(`${m.label} (${price(m)})`, m.id));
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
function usePreset(provider: ApiProvider) {
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
    aiMode: "pro" as const,
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    openaiKey: field<HTMLInputElement>("openaiKey").value.trim(),
    model: modelSelect.value,
    routerModel: routerSelect.value,
  };
  if (!providersWithKeys(chosen).length) {
    note.hidden = false;
    note.textContent = "No API key yet, so Navi runs as Navi Free (on this computer).";
    return;
  }
  const used = activeSettings(chosen);
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
for (const v of KOKORO_VOICES) field<HTMLSelectElement>("naviVoice").add(new Option(`${v.name} (${v.detail})`, v.id));

chrome.tts.getVoices((voices) => {
  const select = field<HTMLSelectElement>("voiceName");
  const current = select.dataset.value ?? "";
  for (const v of voices) {
    if (v.voiceName) select.add(new Option(`${v.voiceName}${v.lang ? ` (${v.lang})` : ""}`, v.voiceName));
  }
  select.value = current;
});

/** The settings Free and Pro each keep their own value for (see MODE_KEYS). */
function fillModeFields(s: Settings) {
  selectValue(modelSelect, s.model);
  field<HTMLSelectElement>("effort").value = s.effort;
  field<HTMLInputElement>("fastMode").checked = s.fastMode;
  field<HTMLInputElement>("maxAgentSteps").value = String(s.maxAgentSteps);
  field<HTMLSelectElement>("autonomy").value = s.autonomy;
  field<HTMLInputElement>("memory").checked = s.memory;
  selectValue(helperSelect, s.subagentModel);
  field<HTMLSelectElement>("subagentEffort").value = s.subagentEffort;
  selectValue(routerSelect, s.routerModel);
  updateModelNote();
}

// Choosing Free or Pro shows that mode's own settings (saving keeps them for that mode).
field<HTMLSelectElement>("aiMode").addEventListener("change", async () => {
  fillModeFields(normalizeSettings(await loadStoredSettings(), field<HTMLSelectElement>("aiMode").value as AiMode));
});

async function fill() {
  const s = await loadSettings();
  field<HTMLSelectElement>("aiMode").value = aiModeOf(s);
  void nanoStatus().then((status) => (document.getElementById("nano-note")!.textContent = `On-device AI: ${NANO_STATUS_TEXT[status]}`));
  field<HTMLInputElement>("apiKey").value = s.apiKey;
  field<HTMLInputElement>("openaiKey").value = s.openaiKey;
  field<HTMLInputElement>("wakeName").value = s.wakeName;
  field<HTMLSelectElement>("listenMode").value = s.listenMode;
  field<HTMLSelectElement>("recognizer").value = s.recognizer;
  field<HTMLInputElement>("sessionTimeoutSec").value = String(s.sessionTimeoutSec);
  field<HTMLInputElement>("lang").value = s.lang;
  field<HTMLSelectElement>("feedback").value = s.feedback;
  const voice = field<HTMLSelectElement>("voiceName");
  voice.dataset.value = s.voiceName;
  voice.value = s.voiceName;
  field<HTMLInputElement>("speechRate").value = String(s.speechRate);
  field<HTMLInputElement>("volume").value = String(s.volume);
  field<HTMLInputElement>("allowPageText").checked = s.allowPageText;
  field<HTMLInputElement>("allowScreenshots").checked = s.allowScreenshots;
  field<HTMLInputElement>("typedPageContext").checked = s.typedPageContext;
  field<HTMLTextAreaElement>("blockedSites").value = s.blockedSites.join("\n");
  field<HTMLSelectElement>("speechOutput").value = s.speechOutput;
  field<HTMLSelectElement>("naviVoice").value = s.naviVoice;
  fillModeFields(s);
}

function clamp(value: string, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings({
    aiMode: field<HTMLSelectElement>("aiMode").value as Settings["aiMode"],
    apiKey: field<HTMLInputElement>("apiKey").value.trim(),
    openaiKey: field<HTMLInputElement>("openaiKey").value.trim(),
    model: modelSelect.value,
    effort: field<HTMLSelectElement>("effort").value as Settings["effort"],
    fastMode: field<HTMLInputElement>("fastMode").checked,
    maxAgentSteps: clamp(field<HTMLInputElement>("maxAgentSteps").value, 1, 30, DEFAULT_SETTINGS.maxAgentSteps),
    wakeName: field<HTMLInputElement>("wakeName").value.trim() || DEFAULT_SETTINGS.wakeName,
    listenMode: field<HTMLSelectElement>("listenMode").value as Settings["listenMode"],
    recognizer: field<HTMLSelectElement>("recognizer").value as Settings["recognizer"],
    autonomy: field<HTMLSelectElement>("autonomy").value as Settings["autonomy"],
    memory: field<HTMLInputElement>("memory").checked,
    subagentModel: helperSelect.value,
    subagentEffort: field<HTMLSelectElement>("subagentEffort").value as Settings["subagentEffort"],
    sessionTimeoutSec: clamp(field<HTMLInputElement>("sessionTimeoutSec").value, 10, 1800, DEFAULT_SETTINGS.sessionTimeoutSec),
    lang: field<HTMLInputElement>("lang").value.trim() || DEFAULT_SETTINGS.lang,
    feedback: field<HTMLSelectElement>("feedback").value as Settings["feedback"],
    voiceName: field<HTMLSelectElement>("voiceName").value,
    speechRate: clamp(field<HTMLInputElement>("speechRate").value, 0.5, 3, DEFAULT_SETTINGS.speechRate),
    volume: clamp(field<HTMLInputElement>("volume").value, 0, 1, DEFAULT_SETTINGS.volume),
    routerModel: routerSelect.value,
    allowPageText: field<HTMLInputElement>("allowPageText").checked,
    allowScreenshots: field<HTMLInputElement>("allowScreenshots").checked,
    typedPageContext: field<HTMLInputElement>("typedPageContext").checked,
    blockedSites: field<HTMLTextAreaElement>("blockedSites")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    speechOutput: field<HTMLSelectElement>("speechOutput").value as Settings["speechOutput"],
    naviVoice: field<HTMLSelectElement>("naviVoice").value,
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

const memoryNote = document.getElementById("memory-note") as HTMLTextAreaElement;
const memoryResult = document.getElementById("memory-result") as HTMLElement;
let memoryEdited = false;

function countMemory() {
  document.getElementById("memory-count")!.textContent = `${memoryNote.value.length.toLocaleString()} / ${MEMORY_CAP.toLocaleString()} characters`;
}

async function showMemory() {
  memoryNote.value = await loadMemory();
  memoryEdited = false;
  countMemory();
}

memoryNote.addEventListener("input", () => {
  memoryEdited = true;
  countMemory();
});

document.getElementById("memory-save")!.addEventListener("click", async () => {
  await saveMemory(memoryNote.value);
  await showMemory();
  memoryResult.textContent = "Saved";
  window.setTimeout(() => (memoryResult.textContent = ""), 2000);
});

document.getElementById("memory-clear")!.addEventListener("click", async () => {
  if (!confirm("Forget everything Navi remembers about you?")) return;
  await clearMemory();
  await showMemory();
  memoryResult.textContent = "Forgotten";
  window.setTimeout(() => (memoryResult.textContent = ""), 2000);
});

// A background update shows up here, unless it would overwrite an edit in progress.
onMemoryChanged(() => {
  if (!memoryEdited) void showMemory();
});
void showMemory();

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

/** What "Test voice" plays: the form's current choices (kept, so Navi's voice loads only once here). */
function testVoice() {
  const lang = field<HTMLInputElement>("lang").value || DEFAULT_SETTINGS.lang;
  const navi = field<HTMLSelectElement>("speechOutput").value !== "chrome";
  return {
    lang,
    navi,
    settings: {
      voiceName: field<HTMLSelectElement>("voiceName").value,
      lang,
      rate: Number(field<HTMLInputElement>("speechRate").value) || 1,
      volume: Number(field<HTMLInputElement>("volume").value),
      neural: navi ? { voice: field<HTMLSelectElement>("naviVoice").value } : undefined,
    },
  };
}

let testSpeaker: Speaker | null = null;

document.getElementById("test-voice")?.addEventListener("click", async () => {
  const test = testVoice();
  testSpeaker ??= new Speaker(
    () => testVoice().settings,
    (message) => (saved.textContent = `${message} Using Chrome's voice.`),
  );
  let name = test.settings.voiceName || (await pickVoice(test.lang)) || "the default voice";
  if (test.navi) {
    saved.textContent = "Loading Navi's voice (the first time, it downloads 92 to 326 MB)…";
    try {
      await testSpeaker.prepareVoice();
      saved.textContent = "";
      name = "Navi's on-device voice";
    } catch {
      saved.textContent = "Couldn't load Navi's voice. Using Chrome's voice.";
    }
  }
  await testSpeaker.say(`Hi, I'm Navi. This is ${name}.`);
});
