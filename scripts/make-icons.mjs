// Renders the extension icon SVG to PNGs with Playwright's Chromium.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#4c6ef5"/><stop offset="1" stop-color="#7048e8"/></linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>
  <path d="M40 92V36h10l28 38V36h10v56H78L50 54v38z" fill="#fff"/>
</svg>`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: true });
  await writeFile(`src/icons/icon${size}.png`, png);
}
await browser.close();
console.log("icons written");
