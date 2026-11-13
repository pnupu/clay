# Clay

Clay is a live decision playground: your agent shapes it from web data, and you shape the decision by hand.

Built for the Junction 2026 challenge "The Web Is Your Real-Time Database" by Context.dev.

People often do not know what they want until they can try concrete things. So:

1. Your own agent (Claude Code, Codex, T3 Code, on your own model subscription) builds a playground for a decision, from live web data.
2. You explore it alone, at full speed. No agent and no network call sits between a move and its result.
3. The settled state goes back to the agent as a precise instruction: the choice, the assumptions, the tolerance, and the range of values you tried.
4. The decision stays live as the web changes.

The app needs no LLM key. All model work is done by the person's agent through the MCP server. The web data comes from Context.dev.

## Start

```bash
pnpm install
pnpm dev
```

This binds to 127.0.0.1 on port 43117. Use `PORT=<port> pnpm dev` for another port. The dev server uses webpack on purpose: with Turbopack (the default of this Next.js version) a page reloaded in a loop when an API request came before the first page load, which is what an agent does. The app needs `CONTEXT_DEV_API_KEY` in `.env.local` (git-ignored).

Open http://127.0.0.1:43117/ for the list of playgrounds. The built-in example is "Which auth provider should a B2B SaaS use?" at `/p/auth-providers`: the public pricing pages of Clerk, WorkOS, Supabase Auth and Stytch, plus one clearly labelled demo vendor (Northwind Auth) whose pricing page this app serves, so a presenter can change a price live.

## Production

The app runs at **https://clay-steel-nu.vercel.app** (Vercel project `clay`, production only). Anyone can open a playground link and move the controls; that runs in the browser and costs nothing. Everything that writes state or spends Context.dev requests needs the owner key: the MCP endpoint, creating, revising, collecting, re-checking, webhook monitors, saving a decision, the exploration summary and the demo-page editor.

```bash
# Claude Code
claude mcp add --transport http clay https://clay-steel-nu.vercel.app/api/mcp --header "Authorization: Bearer <owner key>"

# Codex (reads the key from an environment variable)
export CLAY_ACCESS_KEY=<owner key>
codex mcp add clay --url https://clay-steel-nu.vercel.app/api/mcp --bearer-token-env-var CLAY_ACCESS_KEY
```

A browser gets the key once through the owner link `https://clay-steel-nu.vercel.app/enter#key=<owner key>`. The key is in the URL fragment, which a browser does not send to a server, so it stays out of request logs. The page posts it once, the server sets an httpOnly, Secure, SameSite=Strict cookie that holds a value derived from the key, and the browser moves on to `/`.

## Connect your agent (local)

The local MCP endpoint is `http://127.0.0.1:43117/api/mcp` (Streamable HTTP). The app must be running. Without `CLAY_ACCESS_KEY` the development server (`pnpm dev`) needs no key. A production build (`pnpm start`) and an app with `PUBLIC_BASE_URL` always need one.

```bash
# Claude Code
claude mcp add --transport http clay http://127.0.0.1:43117/api/mcp

# Codex
codex mcp add clay --url http://127.0.0.1:43117/api/mcp
```

Then ask in your own words, for example: "I need to pick an email service for my app, about 30k emails a month now, maybe 200k later. Which one makes sense?" The agent builds a playground and gives you its URL. Explore, select a vendor, set a tolerance and save. Later ask "what did I decide, and does it still hold?".

### Tools

| Tool | What it does |
|---|---|
| `create_playground` | Builds a playground from a config (question, product, metrics with ranges and initial values, features, vendors with a pricing URL or domain). Reads every pricing page. Returns the URL and what was collected per vendor, with unknowns, quarantined values and a problems list. |
| `read_playground` | Control values now, ranking, unknowns, the saved decision with its tolerance, the exploration summary (per control: the range tried and the value settled on) and change events since a time. Reads stored data only. Without an id it lists the playgrounds. |
| `recheck_playground` | Re-reads every pricing page now. Returns what changed and whether the saved decision still holds. |
| `revise_playground` | Changes a playground in place: add, replace or remove vendors, metrics and features, or change the question and the extraction notes. Used to repair a first build and when the person wants something the page lacks. |

The full descriptions are in `lib/mcp.ts`. They are the product's API for another model. The server also sends `instructions`: many clients load tool descriptions on demand and show the agent only the tool names, and without the instructions a real agent answered from memory and never called a tool (see `run/MANIFEST.md`).

### Why Streamable HTTP inside the app

The official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2) has `WebStandardStreamableHTTPServerTransport`, which takes a web `Request` and returns a `Response`. That is exactly a Next.js route handler, so `app/api/mcp/route.ts` is 20 lines: a fresh server and transport per request, stateless, JSON responses. The tools call `lib/` directly in the same process, so there is no second server, no HTTP hop and no second copy of the validation. A stdio server would need its own process and would have to call the app over HTTP for every tool.

### Access guard

`refused()` in `app/api/respond.ts` is called by every route that changes state or spends Context.dev requests. It checks two things.

- The owner key (`lib/access.ts`, `CLAY_ACCESS_KEY`): `Authorization: Bearer <key>` from an agent, or the owner cookie in a browser. Keys are compared in constant time. With no key configured only the development server is open (`pnpm dev` binds to 127.0.0.1); a production build, Vercel, or an app with `PUBLIC_BASE_URL` refuses every write. A key shorter than 32 characters matches nothing.
- The origin: a request that carries an `Origin` header must come from the app's own page, and the app must be addressed by its own name. So a web page open in the person's browser cannot spend requests or overwrite the saved decision.

Public without a key: the pages, `GET /api/p/<id>/state`, `GET /api/playgrounds`, the demo vendor pricing page (Context.dev must read it) and the webhook route, which is protected by its signature check.

### Trust boundaries

- A playground config is untrusted input. `lib/config.ts` checks it: sizes, types, id formats, https-only pricing URLs on public host names, 2 to 6 vendors, 1 to 5 metrics, up to 6 features, ordered ranges. Unknown keys are rejected.
- Text scraped from web pages is untrusted data. In tool results it is cut short (plan names 60 characters, quotes 120) and marked: quotes are in fields named `untrusted_web_quote`, and every result that contains page text carries a note that says so.
- Tool errors say how to fix the call (which ids exist, which field is wrong).

## How it works

1. Collect: Context.dev Search finds each vendor's pricing page unless the config gives the URL. Context.dev Scrape (`formats.json` with a JSON Schema generated from the config, `maxAgeMs: 0`) returns the structured pricing model and the page text of the same capture. Every fact keeps its source URL, its fetch time and a verbatim quote. A missing fact stays `null` and is shown as unknown.
2. Guard: each extracted number is checked against the page text of the same capture. A number that is not on the page is quarantined: it is shown, but never used in a cost.
3. Playground: the controls come from the config and the extracted data. Every move recomputes the cost per vendor, the ranking and the crossover points in the browser. After the person pauses, the browser reports the range tried and the final value per control; that summary is for the agent.
4. Standing decision: the saved state is the assumptions, the chosen vendor and a tolerance. Rule: the decision holds while the chosen vendor can be fully priced under the saved assumptions and costs at most the tolerance (dollars per month, default 0) more than the cheapest fully priced vendor. `standing()` in `lib/diff.ts` is the one implementation; the screen, the change verdict and the agent tools all use it.
5. Change detection: a webhook from a Context.dev page monitor, the "Re-check" buttons, the agent's `recheck_playground` and a publish of the demo page all call the same `recheck()`. Nothing is re-checked on a timer. It reads the page text (1 credit) and compares its hash. Only when the text changed, it extracts again (5 credits) and diffs the facts.
6. Confirmation: extraction is not deterministic. A change on a real source is recorded only when a second fresh extraction reports it too. A fact changes only when both reads state the same thing: `confirmed()` in `lib/diff.ts` keeps the old state of every plan price, meter and feature on which the two reads differ. While such a part exists, the source shows a note and the next re-check reads the page again. When the second read fails, nothing of the first read is stored. On localhost the app reads the demo page itself and needs no confirmation; on a deployment Context.dev reads the demo page like any other source.

## Layout

- `lib/` has no Next.js or React imports: `domain.ts` (the Domain type, the seed, the extraction schema), `config.ts` (validation of runtime configs), `contextdev.ts` (API client, request pacing, webhook verification), `pipeline.ts` (create, revise, collect, evidence guard, re-check), `pricing.ts` and `diff.ts` (pure computation), `explore.ts` (exploration summary), `report.ts` (what the agent sees), `mcp.ts` (the MCP server and its tool descriptions), `store.ts` (one JSON document: a local file in development, a private Vercel Blob with conditional writes on a deployment; also the daily budget), `access.ts` (the owner key check), `demo.ts` (demo vendor page content).
- `app/page.tsx` lists the playgrounds. `app/p/[pg]/page.tsx` and `app/playground.tsx` are the one screen. `app/api/p/[pg]/*` are thin routes per playground. `app/api/mcp` is the MCP endpoint. `app/demo-vendor/pricing` is the demo vendor's pricing page. `app/enter` and `app/api/access` turn the owner link into the owner cookie.
- `scripts/person.ts` acts as the person in a headless browser. `scripts/fixture-api.ts` is a local stand-in for the Context.dev scrape endpoint, for checks that must not spend requests. `scripts/webhook-test.ts` signs requests as the Context.dev docs specify. `scripts/transcript.py` prints a `claude -p` stream-json transcript in a readable form.

## Limits you should know

- New free Context.dev accounts allow 10 requests per minute. The client waits for a free slot (`CONTEXT_DEV_REQUESTS_PER_MINUTE`, default 10; 0 turns the wait off), so a large build or a build followed by a repair can take up to 2 minutes.
- `CONTEXT_DEV_DAILY_CAP` (default 300, 0 turns it off) caps the Context.dev requests per UTC day. The count is kept in the store. At the cap, a call fails with a message that says so, for the person and for the agent, and no request is sent.
- `CONTEXT_DEV_REQUEST_CAP=<n>` is an optional hard cap on the number of requests logged in `run/requests.jsonl` (local development only).
- The pricing model is "base price plus metered usage with included quantities and graduated tiers, plus features". Pages that set the price with an interactive volume slider, and plans with "unlimited" quantities, extract poorly. Transactional email extracted well; error tracking did not.

## Checks

```bash
pnpm test        # pricing, diff, tolerance, agreement, config validation, request pacing, access guard, daily budget
pnpm typecheck
pnpm lint
pnpm build
node scripts/webhook-test.ts <port> demo                     # needs the running app; no Context.dev request
node scripts/person.ts http://127.0.0.1:<port>/p/<id> '{"set":{"<metric id>":[100,300,200]},"select":"<vendor name>","tolerance":25,"save":true}'
```

The two-read confirmation can be checked without Context.dev: start `node scripts/fixture-api.ts <port>`, start the app with `CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture pnpm dev`, create a playground, then `POST /control` a new page text with a queue of prices and re-check.

## Deployment (Vercel)

```bash
scripts/deploy.sh <new empty directory>   # deploys the committed tree (HEAD) to production
```

The script deploys an export of HEAD without Git metadata, because Vercel blocks a deployment whose commit author is not a member of the team. The commit is recorded as deployment metadata (`commit=<sha>`).

Environment variables (Vercel project `clay`, Production):

| Variable | Purpose |
|---|---|
| `CONTEXT_DEV_API_KEY` | Context.dev API key. Secret. |
| `CLAY_ACCESS_KEY` | The owner key: random, 32 bytes or more. Secret. Without it a deployment refuses every write. |
| `BLOB_READ_WRITE_TOKEN` | Set by Vercel when the private Blob store `clay-store` is connected. `BLOB_STORE_ID` works too. Either one switches the store from the local file to the blob. |
| `CONTEXT_DEV_DAILY_CAP` | Optional. Context.dev requests per UTC day, default 300. |
| `CONTEXT_DEV_REQUESTS_PER_MINUTE` | Optional. Request pacing per function instance, default 10. |
| `PUBLIC_BASE_URL` | Optional. The public https origin. On Vercel it defaults to `https://$VERCEL_PROJECT_PRODUCTION_URL`. It is used for playground URLs, webhook URLs and the demo page URL. Setting it makes the owner key mandatory. |
| `MONITOR_INTERVAL_MINUTES` | Optional. Interval of new webhook monitors, 10 or more; the API default is one run per day. |

- Storage: one private Vercel Blob document (`clay/store.json`). It holds the webhook secrets, so the store is private. Reads bypass the CDN cache. Every write is conditional on the version that was read (the MD5 of the document, which is the blob's ETag); a writer that loses re-reads and applies its change again.
- Function duration: the routes that read pricing pages set `maxDuration = 300` seconds. Vercel Pro allows 800 seconds with fluid compute; a build takes 10 to 120 seconds.
- Webhook URL: `<public base URL>/api/webhooks/context/<playgroundId>/<sourceId>`, set per monitor by "Start webhook monitors". A page monitor run costs 1 Context.dev credit.
- Known limits: request pacing and the re-check queue are per function instance (see the `lean:` comments in `lib/contextdev.ts` and `lib/pipeline.ts`). `run/requests.jsonl` logging is skipped where the filesystem is read-only.
