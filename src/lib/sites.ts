// Spoken site names -> URLs, so common "open X" commands skip the AI entirely.

export const SITES: Record<string, string> = {
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  "my email": "https://mail.google.com",
  "google drive": "https://drive.google.com",
  drive: "https://drive.google.com",
  "google docs": "https://docs.google.com",
  "google calendar": "https://calendar.google.com",
  calendar: "https://calendar.google.com",
  "google maps": "https://maps.google.com",
  maps: "https://maps.google.com",
  youtube: "https://www.youtube.com",
  "youtube music": "https://music.youtube.com",
  github: "https://github.com",
  "stack overflow": "https://stackoverflow.com",
  "hacker news": "https://news.ycombinator.com",
  reddit: "https://www.reddit.com",
  twitter: "https://x.com",
  x: "https://x.com",
  instagram: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  linkedin: "https://www.linkedin.com",
  tiktok: "https://www.tiktok.com",
  netflix: "https://www.netflix.com",
  hulu: "https://www.hulu.com",
  spotify: "https://open.spotify.com",
  twitch: "https://www.twitch.tv",
  amazon: "https://www.amazon.com",
  ebay: "https://www.ebay.com",
  wikipedia: "https://en.wikipedia.org",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  gemini: "https://gemini.google.com",
  outlook: "https://outlook.live.com",
  notion: "https://www.notion.so",
  figma: "https://www.figma.com",
  discord: "https://discord.com/app",
  slack: "https://app.slack.com",
  "whatsapp": "https://web.whatsapp.com",
  canvas: "https://osu.instructure.com",
  carmen: "https://carmen.osu.edu",
  "carmen canvas": "https://osu.instructure.com",
  weather: "https://weather.com",
  espn: "https://www.espn.com",
  "new york times": "https://www.nytimes.com",
  cnn: "https://www.cnn.com",
  "bbc": "https://www.bbc.com",
};

/** Site-specific search URL templates; {q} is replaced with the encoded query. */
export const SEARCH_ENGINES: Record<string, string> = {
  google: "https://www.google.com/search?q={q}",
  youtube: "https://www.youtube.com/results?search_query={q}",
  amazon: "https://www.amazon.com/s?k={q}",
  wikipedia: "https://en.wikipedia.org/w/index.php?search={q}",
  reddit: "https://www.reddit.com/search/?q={q}",
  github: "https://github.com/search?q={q}&type=repositories",
  maps: "https://www.google.com/maps/search/{q}",
  "google maps": "https://www.google.com/maps/search/{q}",
  twitter: "https://x.com/search?q={q}",
  x: "https://x.com/search?q={q}",
  ebay: "https://www.ebay.com/sch/i.html?_nkw={q}",
  spotify: "https://open.spotify.com/search/{q}",
  "stack overflow": "https://stackoverflow.com/search?q={q}",
  images: "https://www.google.com/search?tbm=isch&q={q}",
  "google images": "https://www.google.com/search?tbm=isch&q={q}",
};

/** Sites whose own search "search for …" uses while you're on them. */
const SITE_ENGINES: [RegExp, string][] = [
  [/(^|\.)youtube\.com$/, "youtube"],
  [/(^|\.)amazon\.com$/, "amazon"],
  [/(^|\.)wikipedia\.org$/, "wikipedia"],
  [/(^|\.)reddit\.com$/, "reddit"],
  [/(^|\.)github\.com$/, "github"],
  [/(^|\.)(x|twitter)\.com$/, "x"],
  [/(^|\.)ebay\.com$/, "ebay"],
  [/^open\.spotify\.com$/, "spotify"],
  [/(^|\.)stackoverflow\.com$/, "stack overflow"],
];

/** The search engine for the site at `url`, if it's one Navi can search directly. */
export function siteEngine(url: string | undefined): string | undefined {
  let host = "";
  try {
    host = new URL(url ?? "").hostname;
  } catch {
    return undefined;
  }
  return SITE_ENGINES.find(([re]) => re.test(host))?.[1];
}

export function searchUrl(query: string, engine = "google"): string {
  const template = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.google;
  return template.replace("{q}", encodeURIComponent(query));
}

/**
 * Resolves a spoken destination ("youtube", "github dot com", "docs.python.org")
 * to a URL, or null if it isn't recognizably a site (the AI handles those).
 */
export function resolveSite(spoken: string): string | null {
  const name = spoken
    .trim()
    .toLowerCase()
    .replace(/^(the|my)\s+(?!email)/, "")
    .replace(/\s+(website|site|page|homepage|home page|app)$/, "")
    .trim();
  if (name in SITES) return SITES[name];
  const compact = name.replace(/\s+dot\s+/g, ".").replace(/\s+slash\s+/g, "/").replace(/\s+/g, "");
  if (compact.replace(/\.com$/, "") in SITES && compact.endsWith(".com")) {
    return SITES[compact.replace(/\.com$/, "")];
  }
  if (/^https?:\/\//.test(compact)) return compact;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/.test(compact)) return `https://${compact}`;
  if (/^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/\S*)?$/.test(compact)) return `http://${compact}`;
  return null;
}
