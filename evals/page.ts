// The checker's browser part: opens the playground as the person in headless Chromium and decides whether a person could
// use it. No model judges anything. Page text is untrusted data: it is compared, never followed.
// Every selector comes from adapter.ts. The control discovery is generic (range, checkbox, select, colour inputs).
import { createHash } from "node:crypto";
import type { Browser, Locator, Page } from "playwright-core";
import { EXPLORATION_REPORT, PAGE, missingControls, previewContent, settle, signIn, type Dimension } from "./adapter.ts";
import type { Check } from "./check.ts";

export const CHROME = process.env.CHROME ?? "/snap/bin/chromium";
const cut = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + "…" : s).replace(/\s+/g, " ");

async function open(browser: Browser, baseUrl: string, url: string, key: string | undefined, probe = false) {
  // A tall viewport and a viewport screenshot: a full-page capture draws the sandboxed preview frame wrongly.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  // The checker's probe moves every control to its ends. Those reports are answered here and never reach the server, so the
  // agent later reads only what the person did (personSettles), not what the checker did.
  if (probe) await context.route(EXPLORATION_REPORT, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console error: ${m.text()}`); });
  await signIn(page, baseUrl, key);
  errors.length = 0; // only errors of the playground page count
  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch((e: Error) => e);
  return { context, page, errors, response };
}

/** What the person sees react: the text of the reacting areas, and (with `pixels`) a hash of the preview's pixels when there is one. */
async function observe(page: Page, pixels = true): Promise<string> {
  const parts: string[] = [];
  for (const sel of PAGE.reacts) for (const el of await page.locator(sel).all()) parts.push(await el.innerText().catch(() => ""));
  const preview = page.locator(PAGE.preview).first();
  if (pixels && (await preview.count())) parts.push(createHash("sha1").update(await preview.screenshot().catch(() => Buffer.alloc(0))).digest("hex"));
  return parts.join("\n");
}

/**
 * What the person sees once it has stopped changing (a preview that is still rendering, an animation that runs out).
 * A preview that animates for ever never stops: its pixels differ between any two looks, so they say nothing about a
 * control. Then `animated` is true and only the texts are compared (the outputs, the ranking).
 */
async function settled(page: Page): Promise<{ view: string; animated: boolean }> {
  let last = await observe(page);
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(200);
    const now = await observe(page);
    if (now === last) return { view: now, animated: false };
    last = now;
  }
  return { view: await observe(page, false), animated: true };
}

/**
 * Move one control through other values and say whether anything visible changed. The control is put back afterwards.
 * The probe runs signed in as the owner (a private playground cannot be opened otherwise); its exploration reports are
 * intercepted in open(), so nothing it does is stored.
 */
async function reacts(page: Page, control: Locator, kind: string, animated: { yes: boolean }): Promise<boolean> {
  const { view: before, animated: moving } = await settled(page);
  if (moving) animated.yes = true;
  const changed = async () => { await page.waitForTimeout(250); return (await observe(page, !moving)) !== before; };
  if (kind === "checkbox") {
    await control.click();
    const yes = await changed();
    await control.click();
    return yes;
  }
  if (kind === "buttons") {
    // A group of option or swatch buttons: press the others, then the one that was pressed.
    const buttons = await control.locator("button").all();
    const start = (await Promise.all(buttons.map((b) => b.getAttribute("aria-pressed")))).indexOf("true");
    let yes = false;
    for (const [i, b] of buttons.entries()) if (i !== start) { await b.click(); if (await changed()) { yes = true; break; } }
    if (start >= 0) await buttons[start].click();
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
  const [min, max, step] = [Number((await control.getAttribute("min")) ?? 0), Number((await control.getAttribute("max")) ?? 100), Number((await control.getAttribute("step")) || 1) || 1];
  // Only values on the control's step grid: the browser refuses others. Top of the grid, bottom, middle.
  const grid = (n: number) => String(Number((min + Math.round((n - min) / step) * step).toFixed(6)));
  const steps = Math.floor((max - min) / step + 1e-9);
  const tries = kind === "color" ? ["#ff0000", "#00aa55"] : [grid(min + steps * step), grid(min), grid(min + Math.floor(steps / 2) * step)];
  let yes = false;
  for (const v of tries.filter((x) => x !== start)) { await control.fill(v); if (await changed()) { yes = true; break; } }
  await control.fill(start);
  return yes;
}

export type PageResult = { checks: Check[]; shot: string | null };

/** Load the page, look for error states, move every control, take the contact-sheet screenshot. */
export async function checkPage(browser: Browser, o: { baseUrl: string; url: string; key?: string; dims: Dimension[] | null; shotPath: string }): Promise<PageResult> {
  const { context, page, errors, response } = await open(browser, o.baseUrl, o.url, o.key, true);
  const checks: Check[] = [];
  let shot: string | null = null;
  try {
    // ---- Does it load without an error state and without console errors?
    const status = response instanceof Error ? null : (response?.status() ?? null);
    const rendered = await page.waitForSelector(PAGE.ready, { timeout: 20000 }).then(() => true, () => false);
    // A build that still reads pricing pages: wait for it to end, as the person would watch the vendors arrive.
    const stillBuilding = rendered && !(await page.waitForFunction((sel) => !document.querySelector(sel), PAGE.building, { timeout: PAGE.buildWaitMs }).then(() => true, () => false));
    // The ranking or the preview appears after hydration; a preview then needs time to run.
    // A development server compiles a page on its first visit, which can take well over 5 seconds: wait long enough.
    await page.locator(`${PAGE.preview}, ${PAGE.ranked}, ${PAGE.errors.join(", ")}`).first().waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout((await page.locator(PAGE.preview).count()) ? PAGE.previewSettleMs : 500);
    await page.screenshot({ path: o.shotPath }).then(() => (shot = o.shotPath), () => {});
    const shown: string[] = [];
    for (const sel of PAGE.errors) for (const el of await page.locator(sel).all()) if (await el.isVisible()) shown.push(cut(await el.innerText(), 120));
    const ranked = await page.locator(PAGE.ranked).count();
    const hasPreview = (await page.locator(PAGE.preview).count()) > 0;
    const load =
      response instanceof Error ? `the page did not load: ${cut(response.message)}` :
      status != null && status >= 400 ? `the page answered HTTP ${status}` :
      !rendered ? "the playground never rendered" :
      stillBuilding ? `the page still reads pricing pages after ${PAGE.buildWaitMs / 1000} s` :
      shown.length ? `the page shows an error: ${shown[0]}` :
      !hasPreview && ranked === 0 ? "the page ranks no vendor, so there is nothing to compare" :
      errors.length ? cut(errors[0]) : null;
    checks.push(load ? { id: "page_loads", status: "fail", reason: load } : { id: "page_loads", status: "pass", reason: `loaded, no error state, no console error${hasPreview ? "" : `, ${ranked} vendor(s) ranked`}` });
    if (!rendered) {
      checks.push({ id: "controls", status: "fail", reason: "no page to find controls on" });
      return { checks, shot };
    }

    // ---- Do controls exist, and does each one change something visible?
    const controls = await page.locator(PAGE.controls).locator('input[type="range"], input[type="checkbox"], select, input[type="color"], [role="group"]:has(button)').all();
    const hidden = o.dims ? await missingControls(page, o.dims) : [];
    const dead: string[] = [];
    const animated = { yes: false };
    for (const c of controls) {
      const kind = (await c.evaluate((el) => (el as HTMLInputElement).type ?? "buttons")) as string;
      const name = (await c.getAttribute("id")) || (await c.getAttribute("aria-label")) || cut(await c.locator("xpath=..").innerText().catch(() => kind), 40);
      // A control that cannot be moved at all is as dead as one that changes nothing.
      if (!(await reacts(page, c, kind, animated).catch(() => false))) dead.push(name);
    }
    checks.push(
      !controls.length ? { id: "controls", status: "fail", reason: "the page has no controls" } :
      hidden.length ? { id: "controls", status: "fail", reason: `no control on the page for: ${hidden.join(", ")}` } :
      // lean: on a preview that animates for ever only texts are compared, so a control that changes only the animation
      // and is in no output is reported here too. The kit warns about such a control (it returns no code-ready text).
      dead.length ? { id: "controls", status: "fail", reason: `moving these changes nothing visible: ${dead.join(", ")}${animated.yes ? " (the preview animates on its own, so only the output texts were compared)" : ""}` } :
      { id: "controls", status: "pass", reason: `${controls.length} control(s), each changes something visible${animated.yes ? " (the preview animates on its own, so the output texts were compared, not its pixels)" : ""}` },
    );

    // ---- The preview: no error (covered by the error states above) and not blank.
    if (!hasPreview) checks.push({ id: "preview", status: "na", reason: "the page has no preview" });
    else {
      const visible = await previewContent(page);
      checks.push(!visible ? { id: "preview", status: "fail", reason: "the preview is blank: no visible element in it" } : { id: "preview", status: "pass", reason: `the preview shows ${visible} visible element(s) and no error` });
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
    await page.waitForFunction((sel) => !document.querySelector(sel), PAGE.building, { timeout: PAGE.buildWaitMs }).catch(() => {});
    return await settle(page, o.dims ?? []);
  } catch (e) {
    return { chosen: null, outputs: null, error: `the person could not settle: ${cut(String(e))}` };
  } finally {
    await page.waitForTimeout(500).catch(() => {});
    await context.close();
  }
}
