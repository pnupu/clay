// Proof that the checker can fail: it opens fixture pages with known defects and must fail each for the right reason.
// No agent and no Sorvi server are needed. Run: node evals/selftest.ts
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { CHROME, checkPage } from "./page.ts";

const dir = join(import.meta.dirname, "fixtures");
const server = createServer((req, res) => {
  if (req.url === "/favicon.ico") return void res.writeHead(204).end();
  let page: Buffer | null = null;
  try {
    page = readFileSync(join(dir, (req.url ?? "/").replace(/\/frame$/, "").replace(/[^a-z-.]/g, "")));
  } catch {}
  res.writeHead(page ? 200 : 404, { "Content-Type": "text/html" }).end(page ?? "not found");
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const shots = mkdtempSync(join(tmpdir(), "clay-evals-selftest-"));
const browser = await chromium.launch({ executablePath: CHROME });
const dims = [{ id: "emails_per_month", label: "Emails per month", unit: "emails", min: 0, max: 1000, initial: 100 }, { id: "seats", label: "Seats", unit: "seats", min: 0, max: 1000, initial: 100 }, { id: "scale", label: "Scale", unit: "", min: 0, max: 1, initial: 0.3 }];

/** [fixture page, check that must fail, what its reason must say, checks that must still pass] */
const expectations: [string, string, RegExp, string[]][] = [
  ["dead-control.html", "controls", /changes nothing visible: seats$/, ["page_loads"]],
  ["error-state.html", "page_loads", /the page shows an error: Alpha Mail/, []],
  ["missing.html", "page_loads", /HTTP 404/, []],
  // An animated preview: its pixels always change, so they must not make a dead control look alive.
  ["animated-dead.html", "controls", /changes nothing visible: nothing \(the preview animates on its own/, ["page_loads", "preview"]],
];
let ok = true;
for (const [file, id, reason, passing] of expectations) {
  const { checks } = await checkPage(browser, { baseUrl, url: `${baseUrl}/${file}`, dims: file === "dead-control.html" ? dims : file === "animated-dead.html" ? [] : dims.slice(0, 1), shotPath: join(shots, `${file}.png`) });
  const c = checks.find((x) => x.id === id);
  const good = c?.status === "fail" && reason.test(c.reason) && passing.every((p) => checks.find((x) => x.id === p)?.status === "pass");
  ok &&= good;
  console.log(`${good ? "ok  " : "WRONG"} ${file}: ${checks.map((x) => `${x.id}=${x.status}`).join(" ")}\n      ${id}: ${c?.reason}`);
}
await browser.close();
server.close();
console.log(ok ? "The checker failed every broken page for the expected reason." : "The checker did NOT behave as expected.");
process.exit(ok ? 0 : 1);
