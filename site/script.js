document.documentElement.classList.add("js");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Nav: see-through over the hero, solid below it ---------- */
const nav = document.querySelector(".nav");
const hero = document.querySelector(".hero");
function updateNav() {
  nav.classList.toggle("solid", hero.getBoundingClientRect().bottom < 72);
  nav.classList.toggle("scrolled", scrollY > 8);
}
addEventListener("scroll", updateNav, { passive: true });
updateNav();

/* ---------- Orb: a ring of sound bars that moves with Navi's "voice" ---------- */
function orb(canvas, getEnergy) {
  const ctx = canvas.getContext("2d");
  const core = canvas.parentElement.querySelector(".orb-core");
  const BARS = 84;
  const jitter = new Float32Array(BARS);
  let size = 0, dpr = 1, raf = 0, visible = true, energy = 0;
  const t0 = performance.now();

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    size = canvas.getBoundingClientRect().width;
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    energy += (getEnergy(t) - energy) * 0.12;
    const c = size / 2;
    ctx.clearRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(c, c, size * 0.1, c, c, size * 0.5);
    glow.addColorStop(0, `rgba(124, 108, 255, ${0.22 + energy * 0.25})`);
    glow.addColorStop(1, "rgba(124, 108, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(2, size * 0.0095);
    const r0 = size * 0.205;
    for (let i = 0; i < BARS; i++) {
      const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
      jitter[i] += ((Math.random() - 0.5) * 2 - jitter[i]) * 0.18;
      const shape = 0.55 + 0.45 * Math.sin(a * 3 + t * 2.2) * Math.sin(a * 5 - t * 1.4);
      const len = size * (0.018 + energy * (0.07 + 0.14 * shape + 0.05 * jitter[i]));
      const hue = 235 + 50 * Math.sin(a + t * 0.4);
      ctx.strokeStyle = `hsla(${hue}, 92%, ${72 + energy * 10}%, ${0.45 + energy * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      ctx.lineTo(c + Math.cos(a) * (r0 + len), c + Math.sin(a) * (r0 + len));
      ctx.stroke();
    }
    if (core) core.style.setProperty("--e", energy.toFixed(3));
  }

  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && !reduceMotion) raf = requestAnimationFrame(loop); }

  resize();
  energy = getEnergy(1.3);
  draw(t0 + 1300);
  addEventListener("resize", () => { resize(); draw(performance.now()); });
  if (reduceMotion) return;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(canvas);
  document.addEventListener("visibilitychange", start);
  start();
}

/* ---------- Console: Navi hearing and answering, one command at a time ---------- */
const EXAMPLES = [
  { say: "search wikipedia for red pandas", did: "Searching Wikipedia for red pandas.", path: "Built-in", ms: "52 ms" },
  { say: "scroll down", did: "Scrolling down.", path: "Built-in", ms: "31 ms" },
  { say: "list the headings", did: "23 headings. Taxonomy, Description, Behaviour and ecology…", path: "Built-in", ms: "64 ms" },
  { say: "show numbers", did: "84 flags. Say a number to click it.", path: "Built-in", ms: "40 ms" },
  { say: "click 12", did: "Clicked “nocturnal”.", path: "Built-in", ms: "38 ms" },
  { say: "how long do red pandas live?", did: "About 8 to 10 years in the wild, and longer in zoos.", path: "AI", ms: "1.6 s", ai: true },
  { say: "reply to Sarah saying I'll be late", did: "I wrote “I'll be late” in your reply to Sarah. Send it?", path: "AI · 3 steps", ms: "4.2 s", ai: true },
];

const consoleEl = document.querySelector(".console");
let speaking = 0; // 0 idle, 1 talking, 0.5 working
if (consoleEl) {
  const heard = consoleEl.querySelector(".heard");
  const interim = consoleEl.querySelector(".interim");
  const did = consoleEl.querySelector(".did");
  const path = consoleEl.querySelector(".path");
  const ms = consoleEl.querySelector(".ms");
  const stateText = consoleEl.querySelector(".state b");
  const setState = (cls, text) => {
    consoleEl.classList.toggle("speaking", cls === "speaking");
    consoleEl.classList.toggle("working", cls === "working");
    stateText.textContent = text;
  };
  const show = (ex) => {
    heard.textContent = ex.say; interim.textContent = "";
    did.textContent = ex.did; did.classList.add("show");
    path.textContent = ex.path; path.className = "path " + (ex.ai ? "ai" : "builtin"); ms.textContent = ex.ms;
  };

  orb(consoleEl.querySelector(".orb"), (t) =>
    speaking === 1 ? 0.75 + 0.25 * Math.abs(Math.sin(t * 7.3)) * Math.abs(Math.sin(t * 2.9))
      : speaking === 0.5 ? 0.3 + 0.08 * Math.sin(t * 5)
      : 0.13 + 0.05 * Math.sin(t * 1.6));

  if (reduceMotion) {
    show(EXAMPLES[0]);
  } else {
    (async () => {
      await sleep(1100);
      for (let n = 0; ; n++) {
        const ex = EXAMPLES[n % EXAMPLES.length];
        did.classList.remove("show");
        await sleep(350);
        heard.textContent = ""; interim.textContent = ""; did.textContent = "";
        path.textContent = ""; ms.textContent = "";
        setState("", "Listening");
        await sleep(450);
        // Words arrive as you'd see them from a recognizer: grey while it's guessing, then settled.
        setState("speaking", "Hearing you");
        speaking = 1;
        const words = ex.say.split(" ");
        for (let i = 0; i < words.length; i++) {
          interim.textContent = (i ? " " : "") + words[i];
          await sleep(170 + words[i].length * 22);
          heard.textContent += (i ? " " : "") + words[i];
          interim.textContent = "";
        }
        speaking = ex.ai ? 0.5 : 0;
        if (ex.ai) { setState("working", "Thinking"); await sleep(1100); }
        else await sleep(260);
        speaking = 0;
        setState("", "Listening");
        did.textContent = ex.did; did.classList.add("show");
        path.textContent = ex.path; path.className = "path " + (ex.ai ? "ai" : "builtin"); ms.textContent = ex.ms;
        await sleep(ex.ai ? 3200 : 2300);
      }
    })();
  }
}

document.querySelectorAll(".final .orb").forEach((c) =>
  orb(c, (t) => 0.22 + 0.5 * Math.max(0, Math.sin(t * 1.1)) ** 3 * (0.6 + 0.4 * Math.abs(Math.sin(t * 6.1)))),
);

/* ---------- Demo video and chapters ---------- */
const video = document.getElementById("demo");
const wrap = video.closest(".video-wrap");
const chapters = [...document.querySelectorAll(".chapters button")];
function play(from) {
  video.controls = true;
  if (from != null) video.currentTime = from;
  video.play();
}
wrap.querySelector(".play").addEventListener("click", () => play());
video.addEventListener("play", () => wrap.classList.add("playing"));
chapters.forEach((b) => b.addEventListener("click", () => {
  play(Number(b.dataset.start));
  wrap.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
}));
video.addEventListener("timeupdate", () => {
  const t = video.currentTime;
  chapters.forEach((b) => {
    const s = Number(b.dataset.start), e = Number(b.dataset.end);
    const p = Math.min(1, Math.max(0, (t - s) / (e - s)));
    b.style.setProperty("--p", p.toFixed(3));
    const on = t >= s && t < e;
    b.classList.toggle("current", on);
    if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  });
});

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
