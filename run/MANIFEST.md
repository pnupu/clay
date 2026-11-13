# Run manifest

- Run directory: /home/agent/agent-runs/contextdev-playground-20261113T183408Z-899fa5 (created fresh; git initialised here)
- Start (UTC): 2026-11-13T18:34:08Z
- Host: Linux 6.8.0-147-generic x86_64
- Tools: node v22.23.4, pnpm 12.18.0, npm 10.9.9, git 2.43.0
- Framework: next 16.4.6, react 19.3.0 (from package.json), TypeScript 5
- Scaffold command: `pnpm dlx create-next-app@latest app-tmp --ts --app --no-tailwind --eslint --no-src-dir --import-alias "@/*" --use-pnpm --no-turbopack --yes --disable-git`, then moved to the run directory root
- Dev server: `pnpm exec next dev -H 127.0.0.1 -p <random high port>` (port in run/port while it runs)
- Configuration (non-secret): CONTEXT_DEV_API_KEY read from ~/.config/context-dev/api-key into git-ignored .env.local; PUBLIC_BASE_URL unset (localhost)
- Context.dev docs checked live: https://docs.context.dev/llms.txt, /openapi.json, /webhooks.md, /monitors/overview.md, /monitors/webhooks.md, /scrape/freshness-and-caching.md
- Context.dev account at start: credits_remaining 50999, period credits_used 1
- Request log: run/requests.jsonl (method, path, status, latency, credits; no key, no bodies)
- Local data (git-ignored): .data/store.json, .data/pages/*.md, .data/explore/*

## Continuation by the replacement child (2026-11-13, from 18:52Z)

- Took over at commit f20c1b9 plus uncommitted work; checkpoint commit 9eaf559 before any change. Branch: master.
- Start command now: `pnpm dev` (`next dev -H 127.0.0.1 -p ${PORT:-43117}`). During verification the server ran on random port 35013, then on 43117; both are stopped.
- Docs re-checked live: https://docs.context.dev/openapi.json (scrape, search, monitors, usage), /webhooks.md, /monitors/overview.md, /monitors/webhooks.md.
- Context.dev requests: 50 in total in run/requests.jsonl (26 by the first child, 24 in this continuation). Account after the run: credits_remaining 50885, period credits_used 115 (it was 1 at the start of the first child).
- Monitor contract: 1 monitor created and deleted (GET after delete returned 404, monitors_used 0 of 10, plan free).
- Checks run: `pnpm test` (15 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `node scripts/webhook-test.ts` (7 PASS, twice), `node --env-file=.env.local scripts/monitor-contract.ts`, a headless Chromium run of the demo flow at 1280 and 1920 pixels.
- Screenshots (git-ignored): run/shots/final-1-explore-1280.png, final-2-changed-1280.png, final-3-changed-1920.png, cold-0-empty.png, cold-1-collected-1280.png.
- State left in .data/store.json: 5 sources collected, no saved decision, no change events, demo page at its defaults.
- Code review of 9eaf559..a8bc55c (/code-review, medium): 10 findings, all answered in the follow-up commit. Checks re-run after the fixes: test, typecheck, lint, the browser flow, and 3 concurrent re-checks of one published demo change (1 event).

## Bring-your-own-model slice (2026-11-13, from 20:00Z)

- Started at commit d7c2951, branch master, clean tree. Model and harness: Claude Fable 5.2 in Claude Code.
- Dev server: `PORT=46203 pnpm dev` (random port, 127.0.0.1). A fixture run used the same port with `CONTEXT_DEV_BASE_URL` set to a local stand-in API on port 34177. All of these processes are stopped.
- Docs checked live: https://docs.context.dev/openapi.json (scrape and search parameters; rate limit text: "New Free accounts have 2 concurrent requests and 10 requests per minute"), https://docs.context.dev/llms.txt. MCP SDK: `npm view @modelcontextprotocol/sdk` gave 1.32.2; transport and `registerTool` read from the installed type declarations.
- Context.dev requests in this slice: 28 (4 search, 22 scrape with status 200, 2 scrape with status 429), 94 credits by the request log. Total in run/requests.jsonl: 78 of the 400 cap. `/org/usage` was not called after the rate-limit error.
- Rate-limit error (20:20:56Z, during agent run 4): `Context.dev POST /web/scrape -> 429 RATE_LIMITED API rate limit exceeded: 10 request units are allowed per minute and this request uses 1. Retry in 4 seconds.` Live Context.dev activity was stopped after it. The client now waits for a free slot; that wait was tested as a pure function only, not against the live API.
- Agent runs (claude 2.1.321, `claude -p ... --mcp-config run/agent/mcp.json --strict-mcp-config --setting-sources "" --model claude-opus-5-5 --allowedTools mcp__playground --output-format stream-json --verbose --no-session-persistence`, working directory run/agent/ws). 4 of the 6 allowed runs were used. Transcripts are git-ignored: run/agent/run1.jsonl to run4.jsonl; requests in run/agent/request1.txt to request3.txt. Read them with `python3 scripts/transcript.py <file>`.
  - Run 1 (email service request, first shot): no playground tool was called. The agent tried WebSearch (not permitted), then answered from memory. Cause: the client lists MCP tools by name and loads their descriptions on demand, so the agent never saw the descriptions.
  - Description round 1: server `instructions` added (when to call which tool).
  - Run 2 (same request): `create_playground` first, then `revise_playground` twice to repair SendGrid. Playground `salon-booking-email`: 1 metric (emails per month, 10,000 to 300,000, initial 30,000), 2 features, 5 vendors with pricing URLs. 4 of 5 vendors priced on live data; SendGrid's pricing page gave no plans.
  - Person (scripts/person.ts, headless Chromium): moved the slider through 60,000, 200,000, 280,000, 120,000; selected Resend; saved with a tolerance of $100 per month.
  - Run 3 ("what did I decide, and does it still hold?", new session): `read_playground` (list), `read_playground`, `recheck_playground`. Answer: Resend at 120,000 emails per month, tolerance $100, Resend $83 against Amazon SES $12, gap $71, holds; no price changed. Correct against the stored state.
  - Description round 2: repair guidance (one retry, then drop the vendor), shorter revise and re-check results, search prefers a URL with "pricing".
  - Run 4 (error tracking request): `create_playground` with 2 metrics (errors per month 10,000 to 1,000,000 initial 150,000; team members 1 to 20 initial 6), 1 feature, 5 vendors; then one `revise_playground`, which hit the rate limit. Nothing could be ranked: these pricing pages use volume sliders and "unlimited users". The agent said so to the person.
- Fixture check of the two-read confirmation (no Context.dev request; 9 requests to the stand-in API, logged in run/fixture-requests.jsonl): reads of $25 then $30 recorded no event and kept $20; an unchanged page caused no extraction; reads of $45 and $45 recorded one event with the verdict "no longer the cheapest".
- Checks run on the final commit: `pnpm test` (22 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `node scripts/webhook-test.ts <port> demo` (7 PASS).
- Screenshots (git-ignored): run/shots/agent-built-2-done.png (the agent-built email playground with the saved decision), run/shots/seed-2-done.png (the seed with a saved decision, another vendor selected, and the tolerance rule).
- Code review of d7c2951..2292666 (/code-review, medium): 10 findings. Answers, all in the follow-up commit unless marked declined:
  1. Partly agreeing reads stored unconfirmed values (lib/pipeline.ts): fixed. Only a read whose every difference is confirmed is stored; else nothing is stored and the next re-check reads again. Fixture check: reads 25/2 then 25/3 stored nothing; reads 25/2 then 25/1 stored base 25 and kept the extra price at 1.
  2. `__proto__` and `constructor` as a playground id (routes): fixed in lib/store.ts, the playground map has no prototype. Check: DELETE /api/p/__proto__/decision, GET /api/p/constructor/state and GET /p/constructor all return 404.
  3. The default cheapest vendor was reported as the person's selection (app/playground.tsx): fixed. Only a clicked vendor is reported, and nothing is sent until the person changes something. Browser check: opening the page leaves the exploration empty.
  4. A revision dropped sources together with their monitor record (lib/pipeline.ts): fixed by refusing such a revision until the monitors are stopped. Not exercised: no monitor may be created in this run.
  5. No cross-origin guard on the per-playground routes: fixed with proxy.ts for every state-changing /api request. Check: foreign Origin 403 on decision, recheck and mcp; own Origin 204; own Origin with a foreign Host 403.
  6. The request cap was checked before the wait and ignored requests in flight; fixture mode read the wrong log (lib/contextdev.ts): fixed. Typecheck and the fixture run only.
  7. A replaced vendor kept its old name on the page (lib/pipeline.ts): fixed, the source name follows the config.
  8. After a revision the exploration could name a vendor that is gone or a value outside a narrowed range: fixed for both. Declined: values typed above a slider's maximum are kept on purpose, the number field allows them.
  9. The slider lost whole-number steps on small ranges (app/playground.tsx): fixed, ranges up to 1,000 step by 1 again. Declined: two significant digits on large linear ranges, the number field gives exact values.
  10. A saved decision could not be saved again for the same vendor with new values or tolerance: fixed ("Update saved decision"). Browser check on the fixture playground. Declined as a follow-up: moves made in the last 1.2 seconds before the tab closes are not reported.
- Checks after the review fixes: `pnpm test` (22 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS), the fixture run (8 requests to the stand-in API, 0 to Context.dev; request log still 78 lines), browser runs on the fixture playground and on salon-booking-email.
- proxy.ts was removed again; the same guard is `refused()` in app/api/respond.ts, called by every state-changing route. My first diagnosis of the reload loop was wrong: the loop came back without proxy.ts. Corrected cause: the dev server ran Turbopack (the default of Next.js 16.4.6), and under Turbopack a page reloads in a loop when an API request arrives before the first page load, which is what an agent does (reproduced twice: 162 and 163 navigations in 6 seconds). With `next dev --webpack` the same sequence gave 2 navigations on 5 fresh starts. The `dev` script now uses webpack. The root cause inside Turbopack was not found.
- Code review of 2292666..7171558 (/code-review, medium): 9 findings. Answers, all in the next commit:
  1. An unconfirmed first read was stored when the second read failed (lib/pipeline.ts): fixed, nothing of the first read is stored before the second is back. Fixture check B: first read 30, second read fails, stored facts unchanged, the source shows the error.
  2. A confirmed change was dropped when each read had its own extra difference: fixed at the root. `confirmed()` in lib/diff.ts builds the stored model from the old one and replaces only what both reads state alike (per plan price, meter and feature). Unit test and fixture check A: both reads say base 25, they differ on the extra price; base 25 is stored with one event, the extra price stays 1.
  3. The reported selection could differ from the vendor the screen shows: fixed, the clicked vendor is reported only while the screen shows it as selected.
  4. A revision dropped a typed value above an unchanged range: fixed, a value is dropped only when that revision changes the range.
  5. A call refused by the request cap still waited in the pacing queue: fixed, the cap is checked before and after the wait.
  6. The guard refused the app's own page under a LAN address: fixed, an IP address as host is accepted (it cannot be made to point elsewhere); other host names need PUBLIC_BASE_URL. `pnpm start` now binds to 127.0.0.1 like `pnpm dev`.
  7. A malformed PUBLIC_BASE_URL made the guard throw: fixed, it is parsed inside the try block.
  8. A move away and back within 1.2 seconds was not reported: fixed. Browser check: 60,000 to 90,000 and back is stored as tried up to 90,000, settled on 60,000.
  9. A request that failed or timed out was not logged and did not count toward the cap: fixed, it is logged with status 0.
- Checks after round 2: `pnpm test` (22 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS), the fixture run A to D with the guard checks (0 requests to Context.dev; request log still 78 lines), browser runs on the fixture playground and on salon-booking-email after an API call first.
- Code review of 7171558..868c13f (/code-review, medium): 10 findings. This was the third and last round. Answers, fixes in the next commit:
  1. After a partial confirmation the new page hash was stored, so the unconfirmed part was never read again: fixed. While a part is unconfirmed the old hash stays, the source shows a note, and the next re-check reads again. Fixture checks A and A2.
  2. Two equal reads could count as different because of key order or a missing key: fixed, `confirmed()` compares the facts in a fixed shape. Unit test.
  3. The merged snapshot mixed old facts with the second read's evidence marks and quarantine list: fixed, a kept part keeps its old mark and entries. Not fixed: the `truncated` flag is the second read's.
  4. Opening a page with a restored selection sent a report: fixed. Browser check: reopening leaves the exploration and its time unchanged.
  5. A background change of the sources could erase the stored selection: fixed, a report follows only the person's own action.
  6. Vendor name and currency came from the second read alone: fixed, they need two agreeing reads too. Unit test.
  7. A new plan with a disputed base price kept an evidence mark: fixed with finding 3; the price stays unknown until the reads agree.
  8. A call refused after the pacing wait still used a pacing slot, and the log is read twice per call: declined. It matters only at the cap, and the log is small.
  9. The guard is a call in each handler, not one central place: declined for now. A wrapper would still be per route; a proxy file is the central place and can come back when the Turbopack loop is understood. The webhook route has no guard on purpose: its signature is its authentication.
  10. `pnpm start` could not listen beyond loopback: fixed, `HOST` overrides the default 127.0.0.1.
- Checks after round 3, on the webpack dev server: `pnpm test` (22 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS), fixture run A, A2, B, C, D with the guard checks (0 requests to Context.dev; request log still 78 lines), browser runs on the fixture playground and on salon-booking-email with an MCP call first.
- State left in .data/store.json: playgrounds auth-providers (seed, 5 sources, no decision, demo page at its defaults), dry-run-email (2 vendors, from a manual tool call), salon-booking-email (decision saved: Resend, tolerance 100), error-tracking-six-seats (incomplete after the rate limit).

## Vercel deployment (2026-11-13, from 21:22Z)

- Started at commit adc9d95, branch master, clean tree. Model and harness: Claude Fable 5.2 in Claude Code.
- Production: https://clay-steel-nu.vercel.app, Vercel project `clay` (prj_qxYW7CedFzZpl7diIlRZU1WDxn8S), scope pnupus-projects, plan Pro. No custom domain. The team alias clay-pnupus-projects.vercel.app answers with a redirect to the Vercel login (default deployment protection); no protection setting was changed.
- Provisioned: one private Vercel Blob store `clay-store` (store_dcnfTbJlBgrS5o6r, region iad1), connected to the project for Production with `vercel blob create-store clay-store --access private --yes --environment production`. No Marketplace product, no add-on. Blob usage is metered inside the Pro plan; the store holds one document of a few kilobytes.
- Environment variables (Production): CONTEXT_DEV_API_KEY and CLAY_ACCESS_KEY (both secret, piped from files into `vercel env add <name> --environment production --sensitive`), BLOB_READ_WRITE_TOKEN (set by the store connection). The owner key is in /home/agent/.config/clay/access-key (mode 0600, directory 0700).
- Deploy command: `scripts/deploy.sh <new directory>` (export of HEAD, `vercel deploy --prod --yes --scope pnupus-projects --meta commit=<sha>`). A deploy from the checkout itself was blocked by Vercel: "the commit author doesn't have permission to create deployments for this project" (commits here use the placeholder identity agent@localhost). The first deploy failed with "The Output Directory public is empty" because the project was created without framework detection; `vercel.json` now names Next.js.
- Docs checked live: vercel.com/docs/vercel-blob (private storage, consistent reads with `useCache: false`, conditional writes with `ifMatch`), /docs/functions/limitations (Pro with fluid compute: default 300 s, maximum 800 s), docs.context.dev/openapi.json (monitors, `POST /monitors/{id}/run`, credit usage), /monitors/schedules.md, /account/credits.md (a page monitor run costs 1 credit).
- Store defect found on production and fixed: the ETag header of a blob read is a weak or re-encoded form there, and a conditional write with it never matched (every write after the first failed with "Precondition failed: ETag mismatch"). The version is now the MD5 of the document, which is the blob's ETag. Check against the production store: 4 processes with 4 updates each, 16 of 16 updates kept.
- Production checks (real requests):
  - Without the key: `/`, `/p/auth-providers`, `/demo-vendor/pricing`, `GET /api/p/auth-providers/state` and `GET /api/playgrounds` return 200. POST collect, recheck, decision, explore, watch, demo, playgrounds, DELETE decision and watch, and POST and GET `/api/mcp` return 401; a wrong bearer key returns 401. A headless Chromium visit without the key moved the slider (answer recomputed), showed the read-only notice, had the re-check and monitor buttons disabled and no save button, and stored no exploration.
  - With the key: the seed playground collected 5 of 5 sources through Context.dev in 8.7 s. A decision saved (200, 0.55 s). "Re-check all" returned in 2.2 s with no change.
  - Demo source through Context.dev: publishing a base price of $149 returned the new state after 14.0 s with one event (Growth base price 49 to 149) and the verdict "no longer holds" ($167 above the cheapest, tolerance $100).
  - Real webhook: monitor mon_0524f61d9e614fea92f967ed7b6c8b95 on the demo page (baseline run 1 credit). The page was changed without a re-check, then `POST /monitors/{id}/run` at 21:44:42.8Z. The run completed at 21:45:04.3Z with `change_detected: true` and one webhook delivery; the app stored an event with trigger `webhook` at 21:45:15.5Z (base price 149 to 49, verdict holds). 2 runs, 2 credits (`GET /monitors/credit-usage`). Monitor deleted; `GET /monitors/{id}` returns 404 NOT_FOUND; `GET /monitors/limits` shows monitors_used 0.
  - Bring-your-own-model (claude 2.1.321, `claude -p ... --mcp-config <file with the bearer header, outside the repository> --strict-mcp-config --setting-sources "" --model claude-opus-5-5 --allowedTools mcp__clay --output-format stream-json --verbose --no-session-persistence`). 2 of 3 runs used. Run 1 (email API request with Resend, Postmark, Mailgun): one `create_playground`, playground `transactional-email-api`, 3 of 3 vendors priced, 26 s. Person (scripts/person.ts through the owner link): moved emails per month through 60,000, 200,000, 120,000, selected Postmark, tolerance $100, saved. Run 2 ("what did I decide, does it still hold"): `read_playground` (list), `read_playground`, `recheck_playground`; answer Postmark at 120,000 emails, tolerance $100, $150 against Resend $83, gap $67, holds, no price changed. Correct against the stored state. Transcripts (git-ignored, checked for the key: 0 matches): run/agent/prod-run1.jsonl, prod-run2.jsonl.
- Local checks after the change (file store, no Context.dev request): demo publish re-checks at once (0.6 s, one event), `node scripts/webhook-test.ts <port> demo` 7 PASS, daily cap of 1 refuses the second call with the DAILY_CAP message.
- Context.dev: 38 requests in this task by the daily counter in the production store (27 by the app, 11 monitor and usage calls), 116 in total of the 400 cap. Account after the task: credits_remaining 50716, period credits_used 286. No 429 occurred.
- State left in the production store: the seed `auth-providers` (5 sources, a saved decision for the demo vendor, 2 change events, demo page at its default price) and the agent-built `transactional-email-api` (3 sources, a saved decision). No monitor.
- Checks run on the final commit: `pnpm test` (25 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- Code review of adc9d95..95ba7e6 (/code-review, high): 10 findings. Answers, fixes in the next commit:
  1. At the daily cap the webhook monitors could not be stopped, and the watch route answered a bare 500: fixed. A DELETE is not counted against the budget, and the watch route answers JSON with the message. Local check: watch POST 409 with its message, watch DELETE 200.
  2. The owner link decoded a "+" of a base64 key into a space: fixed, the page reads the raw text after `key=`.
  3. An app without a key was open on every host that is not Vercel: fixed. It is also closed with a public base URL or with a HOST beyond loopback (`isHosted()` in lib/access.ts, unit test).
  4. An empty or malformed `CONTEXT_DEV_DAILY_CAP` turned the cap off: fixed, only an explicit 0 does (`dailyCap()`, unit test).
  5. A store write whose answer was lost made the update run a second time on its own result: fixed. After a failed precondition the document is read again, and when it is exactly what was sent the update returns.
  6. The budget counter lives in the one store document: partly fixed. An update that changes nothing no longer writes (check: 187 ms, read only). Declined as a follow-up, marked `lean:`: a counter blob of its own; the budget is counted before the pacing wait on purpose (a refused call returns at once).
  7. Read-only notice while the state loads: declined, not a defect. The page returns "Loading" until the state is there (app/playground.tsx, `if (!state)`), so the notice is never shown before the answer.
  8. The state reload interval equalled the highlight time of a new event: fixed, reload every 9 s, highlight 30 s. Declined: a reload on tab focus.
  9. The store version is the computed MD5, not the service's ETag: declined, marked `lean:`. The ETag header of a read is not usable on Vercel, and a version from `head()` plus content from `get()` could overwrite silently on a stale read; the MD5 fails closed with an error that names both values.
  10. `scripts/deploy.sh` resolved a relative export directory against the repository: fixed, and a directory inside the repository is refused.
  Also fixed from the cut list: `POST /api/access` with the body `null` answers 401. Declined: scripts that import the Context.dev client write the local store; only the public base host counts as the app's own for browser writes; the demo route repeats the re-check reporting.
- Checks after the review fixes: `pnpm test` (25 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS), 4 processes with 4 updates each against the production store (16 of 16 kept).
- Code review of 95ba7e6..8fcab2e (/code-review, high, round 2): 10 findings. Answers, fixes in the next commit:
  1. The lost-answer check also matched an equal write of another instance (two deliveries of one webhook id both counted as new): fixed. Every write carries a random `rev`, so only the writer's own document matches. Check against the production store: 4 processes applying the identical change, exactly one reported "fresh" in 3 of 3 rounds; 16 of 16 distinct updates kept. Not fixed, marked `lean:`: a third write on top of a lost-answer write.
  2. The keyless mode was guessed from HOST and VERCEL: fixed. Only the development server runs without a key; a production build, Vercel or an app with PUBLIC_BASE_URL needs one. Local check: `pnpm dev` without a key writes (204), `pnpm start` without a key refuses (401). Not fixed, marked `lean:`: a dev server behind a tunnel without PUBLIC_BASE_URL.
  3. The Secure owner cookie could not be set over plain http on a LAN address: fixed, Secure is left out only when the app itself is served over http.
  4. A percent-encoded key in the owner link no longer matched: fixed, %XX is decoded and "+" is kept.
  5. Stopping the monitors stopped at the first error, also for a monitor that is already gone: fixed, a 404 counts as deleted and the loop goes on.
  6. A monitor that was created but could not be stored was orphaned: fixed, it is deleted again.
  7. An ambient HOST closed a local app, and the README promised otherwise: fixed with finding 2; the README states the rule.
  8. The repository check of `scripts/deploy.sh` compared a physical with a logical path: fixed (`pwd -P`). Declined: `realpath -m` on macOS.
  9. The watch route answered an error without the state and logged nothing: fixed, it answers the state with the message and logs.
  10. The 9 s state reload: reverted to 15 s; the 30 s highlight covers two reloads. Declined: a reload on tab focus.
- Checks after round 2: `pnpm test` (25 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS).
- Code review of 8fcab2e..5d67a81 (/code-review, high, round 3, the last): 8 findings. Answers, fixes in the next commit:
  1. The Secure flag of the owner cookie followed a header that a proxy can leave at "http": fixed. A public base URL decides; the request's scheme is used only without one. Checks: production answers `Secure`; a dev server on http://127.0.0.1 answers without it.
  2. `isHosted` was open for any NODE_ENV other than "production": fixed, only NODE_ENV "development" runs without a key (unit test, with the assertions for other environments restored).
  3. The watch POST could answer a bare 500 when the store read failed in the error path: fixed, it falls back to the JSON error.
  4. A stale DELETE could clear the record of a newer monitor: fixed, only the record of the deleted monitor is cleared.
  5. The DELETE loop went on after a rate-limit or quota error and kept only the last message: fixed.
  6. Two concurrent POSTs could orphan a monitor: fixed, an existing record stays and the second monitor is deleted.
  7. A raw key with a literal %XX no longer matched in the owner link: fixed, the raw text is tried first, then the decoded one.
  8. Declined: the store document is serialized twice per write; the watch route has its own `message` helper. Fixed: the two stale comments.
  This commit has had no review of its own: three rounds is the limit.
- Checks after round 3: `pnpm test` (25 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`, webhook test (7 PASS), local guard checks with and without a key.

## Kit slice: one spec, preview playgrounds, sandbox (2026-11-13, from 23:22Z)

- Started at commit f1db121, branch master, clean tree. Model and harness: Claude Fable 5.2 in Claude Code. Run directory (git-ignored): run/kit-20261113T233624Z.
- Dev servers, all on 127.0.0.1 and all stopped at the end: fixture mode (`CONTEXT_DEV_BASE_URL=http://127.0.0.1:<fixture port> CONTEXT_DEV_API_KEY=fixture PORT=<port> pnpm dev`, ports 36325 and 30977, fixture API ports 32891 and one more), real mode (`PORT=<port> pnpm dev`, ports 40905 and 48649). The local store was copied before and after each phase into the run directory.
- Docs checked live: https://docs.context.dev/openapi.json and /brand/lookup-by-domain.md (`POST /brand/retrieve`, `type: by_domain`, 10 credits). Tailwind: `npm view @tailwindcss/browser version` gave 4.3.5; the CDN file was downloaded, hashed (sha384) and scanned: no eval, no fetch, no storage use.
- Context.dev requests in this slice: 8 (1 brand retrieve, 6 scrape, 1 search; all status 200; 36 credits by the request log). No 429. No monitor was created. Total in run/requests.jsonl: 97 of the 400 cap.
- Agent runs (claude 2.1.321, `claude -p ... --mcp-config <file> --strict-mcp-config --setting-sources "" --model claude-opus-5-5 --allowedTools mcp__clay Read [Edit] --output-format stream-json --verbose --no-session-persistence`, working directory: a scratch project outside the repository). 8 of 8 runs used. Transcripts: run/kit-20261113T233624Z/agent/run-*.jsonl, requests in request-*.txt, file diffs in *.diff.
  - a1 button, first shot: Read, kit_reference, create_playground valid on the first call (6 controls, brand palette from stripe.com). a2 (new session): read_playground, then an Edit equal to the settled output.
  - b1 physics, first shot: valid on the first call, the real spring loop from the file, a live damping readout. b2: the settled `const SPRING` line written.
  - g1 toast (a case the reference has no example of), first shot: valid on the first call (CSS placeholders, replay on change, the whole CSS file as output). g2: the file written equal to the settled output.
  - c1 price on the fixture API: the first create was rejected (`notes` on a price spec), the second passed; the agent then distrusted the fixture's identical prices, correctly. Change after it: `notes` is accepted on a price playground and shown under the title.
  - c2 price on live pages: valid on the first call; SendGrid's page gave no plans, one repair, then the vendor was removed through revise_playground.
- Person (scripts/person-kit.ts and scripts/person.ts, headless Chromium): moved the controls, settled or saved. Screenshots: run/kit-20261113T233624Z/shots/a-button-settled.png, b-physics-settled.png, g-toast-viewport.png, c-price-agent-built.png, c-price-seed.png.
- Sandbox: `node scripts/sandbox-check.ts` on the final code: 42 PASS, 0 FAIL (run/kit-20261113T233624Z/sandbox-check-final.txt).
- Checks: `pnpm test` (34 pass), `pnpm typecheck`, `pnpm lint`, `pnpm build`.
