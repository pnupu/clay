# Clay

Clay is a kit for playgrounds: your agent composes a playground for a problem from prebuilt parts, and you shape the answer by hand.

Built for the Junction 2026 challenge "The Web Is Your Real-Time Database" by Context.dev.

People often do not know what they want until they can try concrete things. So:

1. Your own agent (Claude Code, Codex, T3 Code, on your own model subscription) builds a playground from the kit, with facts read live from the web.
2. You explore it alone, at full speed. No agent and no network call sits between a move and its result.
3. The settled state goes back to the agent as a precise instruction: code-ready text, the values, and the range of values you tried. The agent carries it out.
4. A decision whose inputs keep changing stays live as the web changes.

Two kinds of playground exist today. A **preview playground** is a throwaway: a real Tailwind component or a real spring runs in the page, bound to a few controls, and the settled values go back as the final class string or config object. A **price playground** is a standing one: vendors of a usage-priced product ranked on prices read from their pricing pages, with a saved decision that is judged again when a price changes.

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

Then ask in your own words, for example: "this signup button looks off and I can't say why, our brand is linear.app" or "I need to pick an email service for my app, about 30k emails a month now, maybe 200k later". The agent builds a playground and gives you its URL. Explore, then press Settle (preview) or save a decision (price). Tell the agent you are done: it reads the result and writes it into your code, or reports the decision. Later ask "what did I decide, and does it still hold?".

### Tools

| Tool | What it does |
|---|---|
| `create_playground` | Builds a playground from one spec. `view.type: "preview"`: controls from the kit, a sandboxed preview that runs real code, outputs, optional brand data. `view.type: "price_ranking"`: reads every vendor's pricing page and ranks the vendors. The spec is validated first; every error says how to fix it. |
| `kit_reference` | Read-only. The format of a preview playground and two worked specs (a Tailwind button with brand colours, spring physics). |
| `read_playground` | What the person did. Preview: the settled values and outputs, the exploration summary, and whether the preview code ran (with the browser's error when it did not). Price: control values, ranking, the saved decision, change events. `include_spec` returns the current spec. Without an id it lists the playgrounds. |
| `recheck_playground` | Price playgrounds: re-reads every pricing page now. Returns what changed and whether the saved decision still holds. |
| `revise_playground` | Changes a playground in place. Each part given (title, notes, controls, view, outputs, a data source) replaces that whole part; the result is validated like a new spec. |

The full descriptions are in `lib/mcp.ts`. They are the product's API for another model. The server also sends `instructions`: many clients load tool descriptions on demand and show the agent only the tool names, and without the instructions a real agent answered from memory and never called a tool (see `run/MANIFEST.md`).

### The spec

One playground is one spec (`lib/spec.ts`). A preview playground:

```json
{
  "id": "signup-button",
  "title": "How should the signup button look?",
  "data": { "brand": { "domain": "acme.com" } },
  "controls": [
    { "id": "bg", "type": "color", "label": "Background", "meaning": "background colour of the button", "initial": "#3b82f6", "palette": "brand" },
    { "id": "radius", "type": "slider", "label": "Corner radius", "meaning": "border-radius in px", "min": 0, "max": 24, "initial": 4, "unit": "px" }
  ],
  "view": { "type": "preview", "tailwind": true, "html": "<button class=\"bg-[{{bg}}] rounded-[{{radius}}px] px-4 py-2 text-white\">Sign up</button>" },
  "outputs": [{ "id": "class_name", "label": "className of the button", "template": "bg-[{{bg}}] rounded-[{{radius}}px] px-4 py-2 text-white" }]
}
```

- **Controls** come only from the kit: `slider`, `toggle`, `select`, `color`. A kit control always means the same thing, so the hand-back needs no guessing. What a control drives may be anything.
- **The preview** runs the real artifact. `{{control_id}}` in `view.html` and `view.css` is updated in place on every move; `view.js` reads `clay.values`, `clay.onChange(fn)` and `clay.data`. `view.tailwind` loads the in-browser Tailwind v4 build (pinned by version and hash), so arbitrary values such as `rounded-[7px]` work.
- **Data sources** keep their origin on the page: `data.brand` (colours and logos of a site, read by Context.dev `POST /brand/retrieve`, 10 credits, once), `data.inline` (shown as "provided by your agent, not checked"), `data.price_pages` (the price engine).
- **Outputs** are templates rendered from the control values. The page shows them as "What goes back to your agent"; `read_playground` returns them after the person presses Settle.
- A price playground has `view: {"type": "price_ranking"}` and `data.price_pages` (product, metrics, features, vendors). Its metrics and features are its controls, because the extraction reads the pricing pages with their descriptions. One view per playground.

Validation at creation (`lib/kit.ts`, `lib/spec.ts`) rejects: an unknown control type or field, a control nothing uses, a `{{binding}}` or `clay.values.x` to a control that does not exist, an output that references a missing control or none, an initial value outside its range or off its step grid, script tags in the html, sizes over the limits, bad ids, price and preview parts in one spec. Every output is rendered once at the initial values and returned. The preview code cannot run on the server: the create result says "unverified", the page reports to the store whether the code ran in the owner's browser, and `read_playground` returns the error so the agent can repair it with `revise_playground`.

### The preview sandbox

Preview code comes from an agent and is shown to every visitor of the link, so it is untrusted. It runs only in the document that `lib/frame.ts` builds and `GET /p/<id>/frame` serves.

What it enforces:

- **Opaque origin.** The response carries `Content-Security-Policy: sandbox allow-scripts; ...`, and the iframe has `sandbox="allow-scripts"`. The header applies however the URL is opened, also directly in a tab. The preview cannot read Clay's cookies, `localStorage`, `sessionStorage`, IndexedDB or the DOM of the page around it. No forms, popups, top navigation, modals, downloads or workers.
- **No network.** `default-src 'none'`, `connect-src 'none'`: no fetch, XHR, WebSocket or beacon. Scripts: inline code, and the pinned Tailwind build when `view.tailwind` is set (with Subresource Integrity). Images: `data:` URLs and the https hosts of the brand's logos. `frame-ancestors 'self'`: other sites cannot embed the frame.
- **A validated bridge.** The only channel is `postMessage`. The page accepts a message only from the frame's own window, from an opaque origin, in one of two shapes (`ready`, `error`); it reads two fields and cuts the error text to 500 characters. More than 30 messages in 10 seconds stops the preview and removes the frame. The frame accepts values only from its parent window and only when every control gets a value it can have. Nothing the frame sends can settle a result or write to the store, except the error text (cut, stored as data, shown to the agent).
- **Limits.** html 20,000, css 20,000, js 40,000 characters; 12 controls; 6 outputs.
- **Navigation.** A preview that navigates its own frame is removed by the page on the frame's second load.
- The page labels the preview as built by the owner's agent.

`node scripts/sandbox-check.ts http://127.0.0.1:<port>` runs hostile preview code in a real browser and checks each of these (41 checks; no Context.dev request).

What it does not protect against:

- **What the preview shows.** The frame can display anything inside its box, for example a fake sign-in form (it cannot submit a form, but it can show text that asks for a secret). The label says who built it; nothing checks the content.
- **One self-navigation.** CSP cannot stop a document from navigating its own frame. Before the page removes the frame, one request can leave for any host, and its URL can carry what the preview knows: the control values, the brand data and `data.inline`. It carries no Clay cookie, no Referer and nothing of the page around it. It also tells that host the visitor's IP address.
- **CPU and memory.** An endless loop or a heavy animation runs in the visitor's browser. Chromium isolates a sandboxed frame in its own process; other browsers may freeze the tab. The page marks a preview that does not become ready in 10 seconds as failed, but cannot stop its script.
- **The CDN.** With `view.tailwind`, the visitor's browser fetches the Tailwind build from jsDelivr. Subresource Integrity stops a changed file; it does not hide the request from the CDN.
- **Browsers without CSP `sandbox` support** in the header (none of the current ones) would rely on the iframe attribute alone.

### Why Streamable HTTP inside the app

The official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2) has `WebStandardStreamableHTTPServerTransport`, which takes a web `Request` and returns a `Response`. That is exactly a Next.js route handler, so `app/api/mcp/route.ts` is 20 lines: a fresh server and transport per request, stateless, JSON responses. The tools call `lib/` directly in the same process, so there is no second server, no HTTP hop and no second copy of the validation. A stdio server would need its own process and would have to call the app over HTTP for every tool.

### Access guard

`refused()` in `app/api/respond.ts` is called by every route that changes state or spends Context.dev requests. It checks two things.

- The owner key (`lib/access.ts`, `CLAY_ACCESS_KEY`): `Authorization: Bearer <key>` from an agent, or the owner cookie in a browser. Keys are compared in constant time. With no key configured only the development server is open (`pnpm dev` binds to 127.0.0.1); a production build, Vercel, or an app with `PUBLIC_BASE_URL` refuses every write. A key shorter than 32 characters matches nothing.
- The origin: a request that carries an `Origin` header must come from the app's own page, and the app must be addressed by its own name. So a web page open in the person's browser cannot spend requests or overwrite the saved decision.

Public without a key: the pages, `GET /api/p/<id>/state`, `GET /api/playgrounds`, the demo vendor pricing page (Context.dev must read it) and the webhook route, which is protected by its signature check.

### Trust boundaries

- A playground spec is untrusted input. `lib/spec.ts` checks it, with `lib/config.ts` for the price part (sizes, types, id formats, https-only pricing URLs on public host names, 2 to 6 vendors, 1 to 5 metrics, up to 6 features, ordered ranges) and `lib/kit.ts` for the preview part. Unknown keys are rejected.
- Preview code is untrusted content: see "The preview sandbox".
- Brand data (title, colour names) is text from the web: cut short, marked in tool results, and never placed in markup unescaped.
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

- `lib/` has no Next.js or React imports: `spec.ts` (the spec an agent writes, and its validation), `kit.ts` (preview kit: controls, templates, values, exploration), `frame.ts` (the sandboxed frame document, its policy and the bridge), `reference.ts` (the kit reference and its two worked specs), `domain.ts` (the Domain type, the seed, the extraction schema), `config.ts` (validation of the price part of a spec), `contextdev.ts` (API client, request pacing, webhook verification), `pipeline.ts` (create, revise, collect, evidence guard, re-check), `pricing.ts` and `diff.ts` (pure computation), `explore.ts` (exploration summary), `report.ts` (what the agent sees), `mcp.ts` (the MCP server and its tool descriptions), `store.ts` (one JSON document: a local file in development, a private Vercel Blob with conditional writes on a deployment; also the daily budget), `access.ts` (the owner key check), `demo.ts` (demo vendor page content).
- `app/page.tsx` lists the playgrounds. `app/p/[pg]/page.tsx` shows `app/playground.tsx` (price) or `app/kit.tsx` (preview); `app/p/[pg]/frame` serves the sandboxed preview document. `app/api/p/[pg]/*` are thin routes per playground. `app/api/mcp` is the MCP endpoint. `app/demo-vendor/pricing` is the demo vendor's pricing page. `app/enter` and `app/api/access` turn the owner link into the owner cookie.
- `scripts/person.ts` acts as the person on a price playground in a headless browser, `scripts/person-kit.ts` on a preview playground. `scripts/sandbox-check.ts` runs hostile preview code against the sandbox. `scripts/mcp-call.sh` sends one MCP tool call. `scripts/fixture-api.ts` is a local stand-in for the Context.dev scrape endpoint, for checks that must not spend requests. `scripts/webhook-test.ts` signs requests as the Context.dev docs specify. `scripts/transcript.py` prints a `claude -p` stream-json transcript in a readable form.

## Limits you should know

- New free Context.dev accounts allow 10 requests per minute. The client waits for a free slot (`CONTEXT_DEV_REQUESTS_PER_MINUTE`, default 10; 0 turns the wait off), so a large build or a build followed by a repair can take up to 2 minutes.
- `CONTEXT_DEV_DAILY_CAP` (default 300, 0 turns it off) caps the Context.dev requests per UTC day. The count is kept in the store. At the cap, a call fails with a message that says so, for the person and for the agent, and no request is sent.
- `CONTEXT_DEV_REQUEST_CAP=<n>` is an optional hard cap on the number of requests logged in `run/requests.jsonl` (local development only).
- The pricing model is "base price plus metered usage with included quantities and graduated tiers, plus features". Pages that set the price with an interactive volume slider, and plans with "unlimited" quantities, extract poorly. Transactional email extracted well; error tracking did not.

## Checks

```bash
pnpm test        # pricing, diff, tolerance, agreement, spec and kit validation, the bridge, request pacing, access guard, daily budget
pnpm typecheck
pnpm lint
pnpm build
node scripts/webhook-test.ts <port> demo                     # needs the running app; no Context.dev request
node scripts/person.ts http://127.0.0.1:<port>/p/<id> '{"set":{"<metric id>":[100,300,200]},"select":"<vendor name>","tolerance":25,"save":true}'
node scripts/person-kit.ts http://127.0.0.1:<port>/p/<id> '{"set":{"<control id>":[2,16,10]},"probe":"button","settle":true}' shot.png
node scripts/sandbox-check.ts http://127.0.0.1:<port>         # needs the development server; no Context.dev request
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
