// Acts as the person in a headless browser: opens a playground, moves controls, selects a vendor, saves a decision, takes screenshots.
// Usage: node scripts/person.ts <playground url> <steps json> [screenshot prefix]
// Steps: {"set": {"<metric id>": [values...]}, "require": ["<feature id>"], "select": "<vendor name>", "tolerance": 25, "save": true}
import { chromium } from "playwright-core";

const [url, stepsJson = "{}", shot = "person"] = process.argv.slice(2);
const steps = JSON.parse(stepsJson) as { set?: Record<string, number[]>; require?: string[]; select?: string; tolerance?: number; save?: boolean; width?: number };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/snap/bin/chromium" });
const page = await browser.newPage({ viewport: { width: steps.width ?? 1440, height: 1100 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("h1");
await page.screenshot({ path: `run/shots/${shot}-1-opened.png`, fullPage: true });

for (const [metric, values] of Object.entries(steps.set ?? {})) {
  const exact = page.locator(`.control:has(#${metric}) input.value`);
  for (const v of values) {
    await exact.fill(String(v));
    await page.waitForTimeout(150);
  }
}
for (const f of steps.require ?? []) await page.locator("label.check", { hasText: f }).locator("input").check();
if (steps.select) await page.locator("li.vendor", { hasText: steps.select }).getByRole("button", { name: /^Select/ }).click();
if (steps.tolerance != null) await page.getByLabel("Tolerance in dollars per month").fill(String(steps.tolerance));
await page.waitForTimeout(1800); // the exploration report is sent after a pause
if (steps.save) {
  await page.getByRole("button", { name: /Save decision|Replace saved decision/ }).click();
  await page.waitForSelector(".verdict");
}
await page.waitForTimeout(500);
await page.screenshot({ path: `run/shots/${shot}-2-done.png`, fullPage: true });
console.log(JSON.stringify({ answer: await page.locator(".answer").first().innerText().catch(() => null), verdict: await page.locator(".verdict").first().innerText().catch(() => null), rule: await page.locator(".verdict + p").first().innerText().catch(() => null), badges: await page.locator("li.vendor:has(.badge.saved) .name").allInnerTexts(), selected: await page.locator("li.vendor.chosen .name").allInnerTexts(), errors }, null, 1));
await browser.close();
