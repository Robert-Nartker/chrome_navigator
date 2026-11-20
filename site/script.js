document.documentElement.classList.add("js");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Voice field: rows of spoken commands, lit by a moving speech waveform ---------- */
const PHRASES = [
  "open youtube", "scroll down", "click 12", "read this page", "next heading", "go back",
  "search wikipedia for red pandas", "pause", "switch to gmail", "what can i say", "show numbers",
  "type hello world", "press enter", "list the headings", "where am i", "new tab", "grid",
  "reply saying thanks", "skip ahead 30 seconds", "wake up", "go to sleep", "stop", "zoom in",
  "close tab", "what tabs are open", "summarize this", "go to the top", "hey navi",
];
const TEXT = (() => {
  let s = "";
  for (let i = 0; i < 40; i++) s += PHRASES[(i * 11) % PHRASES.length] + " · ";
  return s.toUpperCase();
})();

function voiceField(canvas, { center = 0.33, spread = 0.5, glowTop = true, anchor = null } = {}) {
  const ctx = canvas.getContext("2d");
  const LEVELS = 7;
  const FONT_PX = 12;
  const LINE = 19;
  let w = 0, h = 0, cw = 7.2, cols = 0, rows = 0, dpr = 1, yc = 0, maxHalf = 0;
  let mouse = null, visible = true, t0 = performance.now(), raf = 0, last = 0;
  const colors = [];
  for (let i = 0; i < LEVELS; i++) {
    const k = i / (LEVELS - 1);
    const a = 0.075 + Math.pow(k, 1.5) * 0.62;
    const r = Math.round(150 + 105 * k), g = Math.round(150 + 105 * k);
    colors.push(`rgba(${r},${g},255,${a.toFixed(3)})`);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    w = rect.width; h = rect.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `500 ${FONT_PX}px "JetBrains Mono", ui-monospace, monospace`;
    cw = ctx.measureText("M").width || 7.2;
    cols = Math.ceil(w / cw) + 2;
    rows = Math.ceil(h / LINE) + 1;
    // Center the waveform on the anchor (the headline) wherever the layout puts it.
    if (anchor) {
      const a = anchor.getBoundingClientRect();
      yc = a.top - rect.top + a.height / 2;
      maxHalf = Math.max(40, a.height * 0.75);
    } else {
      yc = h * center;
      maxHalf = h * 0.3;
    }
  }

  // How loud the "voice" is at x (0..1) and time t: bursts like syllables, drifting left to right.
  function envelope(x, t) {
    const syll = Math.abs(Math.sin(x * 9.0 - t * 1.6)) * 0.55
      + Math.abs(Math.sin(x * 21.0 + t * 2.3)) * 0.25
      + Math.sin(x * 47.0 - t * 4.1) * 0.08;
    const phrase = 0.55 + 0.45 * Math.sin(x * 2.4 - t * 0.55);
    const edge = Math.sin(Math.min(1, Math.max(0, x)) * Math.PI) ** 0.6;
    return Math.max(0, syll * phrase * edge);
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `500 ${FONT_PX}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textBaseline = "top";
    const env = new Float32Array(cols);
    for (let c = 0; c < cols; c++) env[c] = Math.min(maxHalf, envelope(c / cols, t) * h * spread + 8);
    const buf = Array.from({ length: LEVELS }, () => new Array(cols));
    for (let r = 0; r < rows; r++) {
      const y = r * LINE;
      const dir = r % 2 ? 1 : -1;
      const px = t * (10 + (r % 5) * 3) * dir + r * 37;
      const shift = ((px % cw) + cw) % cw;
      const base = Math.floor(px / cw);
      for (let L = 0; L < LEVELS; L++) buf[L].fill(" ");
      const dy = Math.abs(y + LINE / 2 - yc);
      const topGlow = glowTop ? Math.max(0, 1 - y / (h * 0.4)) * 0.22 : 0;
      for (let c = 0; c < cols; c++) {
        const idx = ((base + c) % TEXT.length + TEXT.length) % TEXT.length;
        const ch = TEXT[idx];
        if (ch === " ") continue;
        const half = env[c];
        let k = dy < half ? 1 - (dy / half) * 0.5 : Math.max(0, 0.4 - (dy - half) / (h * 0.06));
        k = Math.max(k, topGlow * (1 - Math.abs(c / cols - 0.5) * 1.6));
        if (mouse) {
          const mx = c * cw - mouse.x, my = y - mouse.y;
          const d2 = (mx * mx + my * my) / (130 * 130);
          if (d2 < 1) k = Math.max(k, (1 - d2) * 0.9);
        }
        const level = Math.min(LEVELS - 1, Math.max(0, Math.round(k * (LEVELS - 1))));
        buf[level][c] = ch;
      }
      for (let L = 0; L < LEVELS; L++) {
        const line = buf[L].join("");
        if (!line.trim()) continue;
        ctx.fillStyle = colors[L];
        ctx.fillText(line, -shift - cw, y);
      }
    }
  }

  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    if (now - last > 33) { draw(now); last = now; }
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && !reduceMotion) raf = requestAnimationFrame(loop); }

  resize();
  draw(t0 + 2600);
  if (reduceMotion) {
    addEventListener("resize", () => { resize(); draw(t0 + 2600); });
    return;
  }
  addEventListener("resize", () => { resize(); draw(performance.now()); });
  const host = canvas.parentElement;
  host.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  });
  host.addEventListener("pointerleave", () => { mouse = null; });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); }).observe(canvas);
  document.addEventListener("visibilitychange", start);
  if (document.fonts) document.fonts.ready.then(() => { resize(); });
  start();
}

document.querySelectorAll(".hero-field").forEach((c) =>
  voiceField(c, c.classList.contains("small")
    ? { center: 0.88, spread: 0.3, glowTop: false }
    : { anchor: document.getElementById("hero-title") }),
);

/* ---------- Showcase tabs ---------- */
const tabs = [...document.querySelectorAll('.seg [role="tab"]')];
function selectTab(tab) {
  tabs.forEach((t) => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.dataset.pane).hidden = !on;
  });
  if (tab.dataset.pane !== "pane-demo") document.getElementById("demo").pause();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next); next.focus();
  });
});

/* ---------- Demo video ---------- */
const video = document.getElementById("demo");
const wrap = video.closest(".video-wrap");
wrap.querySelector(".play").addEventListener("click", () => {
  video.controls = true;
  video.play();
});
video.addEventListener("play", () => wrap.classList.add("playing"));

/* ---------- Ticker: repeat the row so it loops seamlessly ---------- */
document.querySelectorAll(".ticker-row").forEach((row) => {
  row.innerHTML += row.innerHTML;
});

/* ---------- Copy and download feedback ---------- */
const toast = document.querySelector(".toast");
let toastTimer = 0;
function say(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
document.querySelectorAll("[data-copy]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = "Copied";
      say("Copied. Paste it into Chrome's address bar.");
      setTimeout(() => (b.textContent = "Copy"), 2000);
    } catch {
      say("Select the address and copy it.");
    }
  }),
);
document.querySelectorAll("[data-download]").forEach((a) =>
  a.addEventListener("click", () => say("Downloading Navi. Next: unzip it, then open chrome://extensions.")),
);

/* ---------- Reveal on scroll ---------- */
if (!reduceMotion && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 3) * 70}ms`;
    io.observe(el);
  });
} else {
  document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
}
