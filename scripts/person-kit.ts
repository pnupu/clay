// Acts as the person on a preview playground in a headless browser: moves kit controls, settles, takes a screenshot.
// Usage: [OWNER_KEY_FILE=<file>] node scripts/person-kit.ts <playground url> <steps json> <screenshot path>
// Steps: {"set": {"<control id>": [values...]}, "probe": "<selector in the preview>", "drag": {"selector", "dx"}, "settle": true}.
// A value is a number (slider), a boolean (toggle), an option value (select) or "#rrggbb" (color). "probe" prints the class
// and the computed style of one element of the real artifact in the preview frame.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const [url, stepsJson = "{}", shot = "kit.png"] = process.argv.slice(2);
const steps = JSON.parse(stepsJson) as { set?: Record<string, (number | boolean | string)[]>; settle?: boolean; wait?: number; probe?: string; drag?: { selector: string; dx: number } };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/snap/bin/chromium" });
// A tall viewport and a viewport screenshot: a full-page capture draws the sandboxed frame wrongly when the page must be resized for it.
const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
if (process.env.OWNER_KEY_FILE) {
  await page.goto(`${new URL(url).origin}/enter#key=${readFileSync(process.env.OWNER_KEY_FILE, "utf8").trim()}`);
  await page.waitForURL((u) => u.pathname === "/" && !u.hash, { timeout: 20000 });
}
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("h1");
await page.waitForTimeout(steps.wait ?? 2500); // the preview reports "ok" 1.5 s after it is ready

for (const [id, values] of Object.entries(steps.set ?? {})) {
  const field = page.locator(`[data-control="${id}"]`);
  for (const v of values) {
    if (typeof v === "number") await field.locator('input[type="number"]').fill(String(v));
    else if (typeof v === "boolean") await field.locator('input[type="checkbox"]').setChecked(v);
    else if (/^#[0-9a-f]{6}$/.test(v) && !(await field.locator(`[data-color="${v}"]`).count())) await field.locator('input[type="color"]').fill(v);
    else await field.locator(`[data-color="${v}"], [data-value="${v}"]`).first().click();
    await page.waitForTimeout(250);
  }
}
const frame = await (await page.waitForSelector("iframe")).contentFrame();
if (steps.drag && frame) {
  const box = await frame.locator(steps.drag.selector).boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + steps.drag.dx, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
}
// What the real artifact in the frame looks like now: the class and computed style of one element.
const probe = steps.probe && frame ? await frame.locator(steps.probe).first().evaluate((el) => { const s = getComputedStyle(el); return { class: el.getAttribute("class"), style: el.getAttribute("style"), backgroundColor: s.backgroundColor, borderRadius: s.borderRadius, paddingLeft: s.paddingLeft, fontWeight: s.fontWeight, boxShadow: s.boxShadow.slice(0, 40), transform: s.transform }; }).catch((e) => String(e)) : undefined;
await page.waitForTimeout(1600); // the exploration report is sent after a pause
if (steps.settle) {
  await page.getByRole("button", { name: /^Settle/ }).click();
  await page.waitForSelector("[data-settled]");
}
await page.waitForTimeout(300);
await page.screenshot({ path: shot });
console.log(JSON.stringify({ url: page.url(), previewFailed: await page.locator('p[role="alert"]').allInnerTexts(), outputs: Object.fromEntries(await page.locator("[data-output]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-output"), e.textContent]))), settled: await page.locator("[data-settled]").count(), probe, errors }, null, 1));
await browser.close();
