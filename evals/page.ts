// The checker's browser part: opens the playground as the person in headless Chromium and decides whether a person could
// use it. No model judges anything. Page text is untrusted data: it is compared, never followed.
// Every selector comes from adapter.ts. The control discovery is generic (range, checkbox, select, colour inputs).
import { createHash } from "node:crypto";
import type { Browser, Locator, Page } from "playwright-core";
import { PAGE, missingControls, settle, signIn, type Dimension } from "./adapter.ts";
import type { Check } from "./check.ts";

export const CHROME = process.env.CHROME ?? "/snap/bin/chromium";
const cut = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");

async function open(browser: Browser, baseUrl: string, url: string, key: string | undefined) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console error: ${m.text()}`); });
  await signIn(page, baseUrl, key);
  errors.length = 0; // only errors of the playground page count
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((e: Error) => e);
  return { context, page, errors, response };
}

/** What the person sees react: the text of the reacting areas, and a hash of the preview's pixels when there is one. */
async function observe(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const sel of PAGE.reacts) for (const el of await page.locator(sel).all()) parts.push(await el.innerText().catch(() => ""));
  const preview = page.locator(PAGE.preview).first();
  if (await preview.count()) parts.push(createHash("sha1").update(await preview.screenshot().catch(() => Buffer.alloc(0))).digest("hex"));
  return parts.join("\n");
}

/** Move one control through other values and say whether anything visible changed. The control is put back afterwards. */
async function reacts(page: Page, control: Locator, kind: string): Promise<boolean> {
  const before = await observe(page);
  const changed = async () => { await page.waitForTimeout(250); return (await observe(page)) !== before; };
  if (kind === "checkbox") {
    await control.click();
    const yes = await changed();
    await control.click();
    return yes;
  }
  if (kind === "select-one") {
    const start = await control.inputValue();
    const options = await control.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    let yes = false;
    for (const v of options.filter((x) => x !== start)) { await control.selectOption(v); if (await changed()) { yes = true; break; } }
    await control.selectOption(start);
    return yes;
  }
  const start = await control.inputValue();
  const [min, max] = [Number((await control.getAttribute("min")) ?? 0), Number((await control.getAttribute("max")) ?? 100)];
  const tries = kind === "color" ? ["#ff0000", "#00aa55"] : [String(max), String(min), String(Math.round((min + max) / 2))];
  let yes = false;
  for (const v of tries.filter((x) => x !== start)) { await control.fill(v); if (await changed()) { yes = true; break; } }
  await control.fill(start);
  return yes;
}

export type PageResult = { checks: Check[]; shot: string | null };

/** Load the page, look for error states, move every control, take the contact-sheet screenshot. */
export async function checkPage(browser: Browser, o: { baseUrl: string; url: string; key?: string; dims: Dimension[] | null; shotPath: string }): Promise<PageResult> {
  const { context, page, errors, response } = await open(browser, o.baseUrl, o.url, o.key);
  const checks: Check[] = [];
  let shot: string | null = null;
  try {
    // ---- Does it load without an error state and without console errors?
    const status = response instanceof Error ? null : (response?.status() ?? null);
    const rendered = await page.waitForSelector(PAGE.ready, { timeout: 20000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    await page.screenshot({ path: o.shotPath, fullPage: true }).then(() => (shot = o.shotPath), () => {});
    const shown: string[] = [];
    for (const sel of PAGE.errors) for (const el of await page.locator(sel).all()) if (await el.isVisible()) shown.push(cut(await el.innerText(), 120));
    const ranked = await page.locator(PAGE.ranked).count();
    const hasPreview = (await page.locator(PAGE.preview).count()) > 0;
    const load =
      response instanceof Error ? `the page did not load: ${cut(response.message)}` :
      status != null && status >= 400 ? `the page answered HTTP ${status}` :
      !rendered ? "the playground never rendered" :
      shown.length ? `the page shows an error: ${shown[0]}` :
      !hasPreview && ranked === 0 ? "the page ranks no vendor, so there is nothing to compare" :
      errors.length ? cut(errors[0]) : null;
    checks.push(load ? { id: "page_loads", status: "fail", reason: load } : { id: "page_loads", status: "pass", reason: `loaded, no error state, no console error${hasPreview ? "" : `, ${ranked} vendor(s) ranked`}` });
    if (!rendered) {
      checks.push({ id: "controls", status: "fail", reason: "no page to find controls on" });
      return { checks, shot };
    }

    // ---- Do controls exist, and does each one change something visible?
    const controls = await page.locator(PAGE.controls).locator('input[type="range"], input[type="checkbox"], select, input[type="color"]').all();
    const hidden = o.dims ? await missingControls(page, o.dims) : [];
    const dead: string[] = [];
    for (const c of controls) {
      const kind = (await c.evaluate((el) => (el as HTMLInputElement).type)) as string;
      const name = (await c.getAttribute("id")) || (await c.getAttribute("aria-label")) || cut(await c.locator("xpath=..").innerText().catch(() => kind), 40);
      if (!(await reacts(page, c, kind))) dead.push(name);
    }
    checks.push(
      !controls.length ? { id: "controls", status: "fail", reason: "the page has no controls" } :
      hidden.length ? { id: "controls", status: "fail", reason: `no control on the page for: ${hidden.join(", ")}` } :
      dead.length ? { id: "controls", status: "fail", reason: `moving these changes nothing visible: ${dead.join(", ")}` } :
      { id: "controls", status: "pass", reason: `${controls.length} control(s), each changes something visible` },
    );

    // ---- The preview: no error (covered by the error states above) and not blank.
    if (!hasPreview) checks.push({ id: "preview", status: "na", reason: "the page has no preview" });
    else {
      const png = await page.locator(PAGE.preview).first().screenshot();
      // A blank frame compresses to almost nothing. lean: a size threshold, not a pixel count; revisit if a real preview is this plain.
      checks.push(png.length < 1500 ? { id: "preview", status: "fail", reason: "the preview is blank" } : { id: "preview", status: "pass", reason: "the preview shows content" });
    }
    if (errors.length && !load) checks[0] = { id: "page_loads", status: "fail", reason: cut(errors[0]) }; // an error raised by moving a control
    return { checks, shot };
  } finally {
    await context.close();
  }
}

/** Act as the person: move the controls, then settle or save. Returns what was settled. */
export async function personSettles(browser: Browser, o: { baseUrl: string; url: string; key?: string; dims: Dimension[] | null }) {
  const { context, page } = await open(browser, o.baseUrl, o.url, o.key);
  try {
    if (!(await page.waitForSelector(PAGE.ready, { timeout: 20000 }).then(() => true, () => false))) return { chosen: null, outputs: null, error: "the playground never rendered" };
    return await settle(page, o.dims ?? []);
  } catch (e) {
    return { chosen: null, outputs: null, error: `the person could not settle: ${cut(String(e))}` };
  } finally {
    await page.waitForTimeout(500).catch(() => {});
    await context.close();
  }
}
