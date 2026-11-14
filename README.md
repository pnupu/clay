# Clay

Clay is a kit for playgrounds: your agent composes a playground for a problem from prebuilt parts, and you shape the answer by hand.

Built for the Junction 2026 challenge "The Web Is Your Real-Time Database" by Context.dev.

People often do not know what they want until they can try concrete things. So:

1. You ask your own agent (Claude Code, Codex, T3 Code, on your own model subscription) for one: "build me a playground for ...". It builds a playground from the kit, with facts read live from the web.
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

## Accounts

- Visitor (not signed in): opens the home page and the example playgrounds, and uses them fully: every control, every result. Nothing is saved, re-checked, created or spent.
- Person (signed in through Clerk; open sign-up with GitHub, Google, or an email address and a password): owns the playgrounds their agent creates. Only they and the admin can open, save, re-check, revise and delete them. A playground that is not an example is private: another person or a visitor sees "This playground is private" and nothing of its content.
- Admin (the owner key, `CLAY_ACCESS_KEY`): everything, as before. Marks a playground as an example (`POST /api/p/<id>/example` with `{"example": true}` or `false`, or the button under "All playgrounds" on the home page), chooses the featured example that the landing page embeds (`{"example": true, "featured": true}`; one at a time, else the newest example is embedded), starts webhook monitors and edits the demo page. Playgrounds without an owner (all created before accounts) are the admin's. The seed `auth-providers` is an example unless the admin unmarks it.
- Clay stores only the Clerk user id per person, the SHA-256 hash of their agent key and their request count of the day (`users` in the store). No email address or name.

Connect your agent: after sign-in, `/connect` creates a personal agent key (`clay_` and 32 random bytes). It is shown once and stored as a hash; a new key replaces the old one, and "Revoke key" removes it. The MCP endpoint takes it as `Authorization: Bearer <agent key>` and acts as that person: `create_playground` makes the playground theirs, and `read_playground` lists only theirs (examples can be read by id).

```bash
# Claude Code: --scope user makes Clay available in every folder (the default scope is only the current folder)
claude mcp add --scope user --transport http clay https://<host>/api/mcp --header "Authorization: Bearer <agent key>"

# Codex (reads the key from an environment variable; put the export in your shell profile)
export CLAY_AGENT_KEY=<agent key>
codex mcp add clay --url https://<host>/api/mcp --bearer-token-env-var CLAY_AGENT_KEY
```

- Claude Code asks once per Clay tool whether to allow it; the person allows it.
- `codex exec` cannot ask, so Clay's tools are refused until `default_tools_approval_mode = "approve"` is under `[mcp_servers.clay]` in `~/.codex/config.toml`. It can only read files unless run with `-s workspace-write`; for a later turn the flag goes before `resume`: `codex exec -s workspace-write resume --last "I'm done."`.
- Another MCP client: Streamable HTTP at `https://<host>/api/mcp` with the header `Authorization: Bearer <agent key>`.
- How a person asks: "build me a playground for …". In Claude Code also `/mcp__clay__playground <what you want to try>`.
- A lost key: create a new one on `/connect` (the old one stops working); in Claude Code remove Clay and add it again, in Codex change the export. Remove Clay with `claude mcp remove clay` or `codex mcp remove clay`. When Clay is in more than one Claude Code scope (an earlier add without `--scope user`), `claude mcp remove clay` refuses and lists them; remove each with `--scope local` (in that folder) and `--scope user`.

`/connect` shows these commands with the person's key filled in, each with a Copy button, and two example requests (a look or a feel; a decision on prices).

Limits per person: `CLAY_USER_DAILY_REQUESTS` (default 40) Context.dev requests per UTC day, caused by their agent or their page, and `CLAY_USER_PLAYGROUNDS` (default 20) playgrounds. 0 turns a limit off. The deployment-wide `CONTEXT_DEV_DAILY_CAP` stays. Deployment-wide, a person cannot create a playground once the deployment holds `CLAY_MAX_PLAYGROUNDS` playgrounds (default 2,000) or its store `CLAY_MAX_STORE_BYTES` characters (default 10,000,000); the operator is not bound. Each person's own playgrounds may hold `CLAY_USER_STORE_BYTES` characters (default 600,000: 20 playgrounds the size of the largest live example, about 26,000 characters). Both are checked inside the store update, on the size it leaves, for everything that grows a person's playgrounds: a create, a revision, and pages that a build or a re-check stores later. A write that does not grow them (a delete, a smaller revision) always passes. So filling the deployment takes about 16 signed-up accounts (the 10,000,000 less what the store already holds, at 600,000 each), each holding its full allowance, for example 4 playgrounds of about 150,000 characters made with 4 creates, or 20 smaller ones: about 70 requests in all, and no web request is needed. A person who owns nothing and meets a full store is told to ask the operator. Every request reads and parses the one store document: measured on a development machine, 1 MB takes about 2 ms, 10 MB about 25 ms and 50 MB about 150 ms to read and parse (and about as long again to write), before the blob transfer on Vercel. At a limit the person and the agent get a message that says which limit and what to do. After 20 requests with a wrong bearer token in 10 minutes, an address gets 429 for the rest of the window (per function instance; the keys have 256 bits).

How it is wired: `proxy.ts` runs Clerk's `clerkMiddleware()` on pages and the browser's API calls (not on `/api/mcp` and the webhooks). `identify()` in `app/api/respond.ts` resolves the caller: owner key, then agent key, then Clerk session. `refused()` binds the caller to the request (`bindActor()` in `lib/accounts.ts`, an AsyncLocalStorage), so `newPlayground()` stamps the owner and the Context.dev client counts the request against the person. The access rules are `canRead()` and `canWrite()` in `lib/accounts.ts`. Without Clerk keys the app runs as before: owner key only, and the development server without `CLAY_ACCESS_KEY` is open.

Testing sign-up locally: Clerk development instances accept test addresses `<anything>+clerk_test@example.com` with the fixed code `424242`. A headless browser must send a Clerk Testing Token (`POST https://api.clerk.com/v1/testing_tokens` with the secret key, added as `__clerk_testing_token` to Frontend API requests), or Clerk's bot check stops the sign-up form.

## Production

The app runs at **https://clay-steel-nu.vercel.app** (Vercel project `clay`, production only). Anyone can open an example and move the controls; that runs in the browser and costs nothing. Everything that writes state or spends Context.dev requests needs a signed-in owner, their agent key, or the owner key (see Accounts). The admin connects with the owner key:

```bash
# Claude Code
claude mcp add --transport http clay https://clay-steel-nu.vercel.app/api/mcp --header "Authorization: Bearer <owner key>"

# Codex (reads the key from an environment variable)
export CLAY_ACCESS_KEY=<owner key>
codex mcp add clay --url https://clay-steel-nu.vercel.app/api/mcp --bearer-token-env-var CLAY_ACCESS_KEY
```

A browser gets the key once through the owner link `https://clay-steel-nu.vercel.app/enter#key=<owner key>`. The key is in the URL fragment, which a browser does not send to a server, so it stays out of request logs. The page posts it once, the server sets an httpOnly, Secure, SameSite=Strict cookie that holds a value derived from the key, and the browser moves on to `/`.

## Connect your agent (local)

The local MCP endpoint is `http://127.0.0.1:43117/api/mcp` (Streamable HTTP). The app must be running. Without `CLAY_ACCESS_KEY` and without Clerk keys the development server (`pnpm dev`) needs no key; with Clerk keys, use an agent key from `/connect` or set `CLAY_ACCESS_KEY`. A production build (`pnpm start`) and an app with `PUBLIC_BASE_URL` always need one.

```bash
# Claude Code (--scope user: in every folder)
claude mcp add --scope user --transport http clay http://127.0.0.1:43117/api/mcp

# Codex
codex mcp add clay --url http://127.0.0.1:43117/api/mcp
```

Then ask for a playground: type "build me a playground for …" with what you want to try, tune or decide. For example: "build me a playground for this signup button, it looks off and I can't say why, our brand is linear.app" or "build me a playground for this: which email service for my app, about 30k emails a month now, maybe 200k later?". Other words work too ("make a playground …", "let me play with it first", "clay this").

The server also has two MCP prompts, so nothing must be pasted anywhere. Claude Code shows an MCP prompt as a command (its documentation: "Claude Code lists each MCP prompt as `/servername:promptname (MCP)`. Typing `/mcp__servername__promptname` also runs it."; "Pass them space-separated after the command."):

- `/mcp__clay__playground <what you want to try, tune or decide>` (listed as `/clay:playground`): the same request with the whole loop. Without words after it, the agent asks what you want to play with. Claude Code 2.1.321 splits the words on spaces and gives the prompt only the first one; the agent still reads the whole line, which Claude Code puts into the conversation, and the prompt text says so.
- `/mcp__clay__recheck [which decision]` (listed as `/clay:recheck`): "is my saved decision still right?".

Codex CLI 0.167.0 has no commands for MCP prompts (its documentation lists tools, server instructions and authentication as the supported MCP features, and no prompts): in Codex, type the sentence. The agent builds a playground and gives you its URL. Explore, then press Settle (preview) or save a decision (price). Tell the agent you are done: it reads the result and writes it into your code, or reports the decision. Later ask "what did I decide, and does it still hold?".

### Optional: let your agent offer a playground on its own

With its normal tools on (a shell, web search), Claude Code often does not use Clay unless you ask for a playground: it edits the file by guess, answers from the file, or looks the price up itself. A standing instruction in your own project changes that. Paste these lines into the `CLAUDE.md` of your project (Claude Code) or its `AGENTS.md` (Codex). The text is in [`connect/standing-instruction.md`](connect/standing-instruction.md), and `/connect` offers it with a Copy button.

```markdown
## Clay playgrounds

When I say something looks or feels off, or I ask which option to choose and the answer depends on prices or on my own numbers, do not guess, edit or answer first. Build a Clay playground with the Clay MCP tool create_playground, give me the link, and wait until I say I am done. Then call read_playground and carry out what I settled. An exact instruction ("make the radius 8px") or a plain fact needs no playground.
```

Measured on 2026-11-14 with `evals/` (`--tools normal`: the agent keeps its shell, web search and file tools, in a clean home; first answer only; Claude Code 2.1.321 with its default model, Claude Opus 5.5; fixture web data). "Built" means that the agent called `create_playground` in its first answer.

| What the agent had | 4 vague requests, 3 runs each | 2 requests that build anyway | 3 requests that need no playground |
|---|---|---|---|
| Clay's own instructions only | built in 2 of 12 | 2 of 2 | built in 0 of 3 |
| and these lines in `CLAUDE.md` | built in 12 of 12 | 2 of 2 | built in 0 of 9 |
| and a personal skill instead of the lines (not shipped) | built in 4 of 12 | 2 of 2 | built in 0 of 3 |
| Codex CLI 0.167.0, these lines in `AGENTS.md`, one run each | built in 4 of 4 | 2 of 2 | built in 0 of 3 |

The four vague requests are a button that "feels sluggish", a button that "looks flat and cramped", "are we on the right model, bench.json has what we measured", and "when does the paid plan start to make sense for us". Without the lines Claude Code edited the file, answered from the benchmark, or fetched the pricing page. Three rewordings of Clay's own instructions did not change that (1 of 4 each). Codex built a playground in 7 of 7 such requests without the lines. The numbers are small: one model per agent, twelve runs at most, and only whether a playground was built, not how good it was.

### Coming back to a decision

A button is a one-off. A provider, model or GPU choice is a standing decision: its prices and facts keep changing, and nobody returns to a page they must remember. So the decision lives where the person already works, in their repository.

- When a person has saved a decision on a price playground, or settled a preview that reads web facts (`data.web`), `read_playground` returns `decision_record`: a path, `.clay/decisions/<playground id>.md`, and the text of the file. The server builds the text; the agent writes it as given, beside carrying out the choice. A playground without live data gets no record.
- The file is for two readers. The person reads what was chosen, at which values, under which rule (with the tolerance), and from which facts, each with its source address and read time. A later agent with no memory reads one paragraph: before work that depends on this choice, or when the person asks whether it still holds, call `recheck_playground` with this id. The file holds no key and nothing about the person.
- `recheck_playground` starts its answer with the verdict. When the decision no longer holds, it gives what changed (old value, new value, source, read time), what the saved rule now picks, and what to do: tell the person in two lines with the link, propose the change, and change the code and the file only after they agree. When it still holds: one line, and the new "Last checked" line for the file. The rule is the one on the page (`standing()` in `lib/diff.ts`); for a preview on web facts Clay reports the changed facts and the agent judges.
- Why a dot folder with one file per decision: it is the place tools keep their own state in a repository (`.github`, `.claude`), it does not mix with the team's own documents, one decision is one file to read, replace or delete, and the playground id in the file name is the argument of the re-check.
- Text that Clay did not write (a vendor, plan or row name from a web page; a title, label or reason from the spec) is data in the file: always in double quotes inside a line that Clay starts, on one line, cut short, without quotes, backticks, pipes, brackets or hidden characters; the settled outputs are quoted line by line (`>`). The file says so before the first such text.
- Proof: `node evals/return.ts` (cases of kind `return`, fixture prices, `evals/return-fixture.ts`). A fresh Claude Code session in a repository that holds only code and the decision file is asked "is our email provider still the right pick?", with no Clay word in the request. Measured on 2026-11-14, Claude Code with its normal tools and default model (Claude Opus 5.5) in a clean home, one run at a time, 10 runs:

| Case | Standing instruction | Runs | Found the file, called `recheck_playground` with its id, answered correctly |
|---|---|---|---|
| holds: prices unchanged | absent | 2 | 2 of 2 |
| broken: the chosen vendor went from $20 to $45 | absent | 3 | 3 of 3 |
| model: a settled preview on web facts, the chosen model's prices went up sixfold | absent | 1 | 1 of 1 |
| holds and broken | present | 2 | 2 of 2 |
| write: the first session writes the file as given | absent | 2 | 2 of 2 |

In the "no longer holds" runs the agent named the old and the new price and what the rule now picks, gave the link, proposed the change and changed no code. Two of the ten runs were recorded as failed by the checker and were correct on reading: one pattern for "proposes the change" was too narrow, and one check expected a new "Last checked" line when the re-check fell in the same minute as the build. Both checks are corrected in `evals/return.ts`; after a code review the checks were also made stricter (the agent must open the file before the re-check; exact dollar amounts), and every saved answer passes the stricter checks.

A scheduled re-check in the person's own repository: [`public/clay-recheck.yml`](public/clay-recheck.yml) (the app serves it at `/clay-recheck.yml`) is one GitHub Actions workflow file. Save it as `.github/workflows/clay-recheck.yml`, add your agent key as the repository secret `CLAY_AGENT_KEY`, and the repository itself is the alarm. Every day, and on "Run workflow", it re-checks each `.clay/decisions/*.md` with `POST /api/p/<id>/recheck` and `{"verdict": true}`, which answers with the same verdict fields as `recheck_playground`. When a decision no longer holds it opens one issue for it: the verdict, what changed (old value, new value, source, read time), what the saved rule now picks, the playground link, and a paragraph for an agent that is assigned the issue (re-check again, propose the change, change nothing before the person agrees). While the decision stays broken the issue is updated, never opened twice; when it holds again the issue is closed with one line. For a settled preview Clay saves no rule, so changed facts open an issue that asks for a judgement. NOT KNOWN, a refusal (allowance used up, playground deleted, someone else's example) and a network error change no issue and leave one line in the job log. The job fails only when the set-up is broken: Clay refuses the key, the issues cannot be read or written, or no decision file names the workflow's Clay address. An issue that you close yourself is not opened again for the same facts. The key is sent only to the Clay address named in the workflow, so a decision file that names another address is skipped.

- Cost: each run reads every source of every decision file again and counts against your daily allowance (40 web requests by default). Measured on the fixture: a price decision costs one request per vendor when nothing changed and two more for each vendor whose page changed; a decision on web facts costs one per page, three when the page changed. Daily suits a few decisions; with more than about ten vendors and pages in total, run it weekly.
- It commits nothing. To keep the "Last checked" line of the files current, add a step that replaces that line with `decision_file.with` from the answer and commits, and give the job `contents: write`; an agent does the same when it re-checks.
- Proof: the workflow's own script (`connect/github/clay-recheck.sh`, kept equal to the file by `evals/recheck-workflow.test.ts`) ran against a local server on the fixture, with a signed-up test person's own agent key and decision files written from real `read_playground` answers, for every case above; `gh` was a stand-in that records its calls (`evals/recheck-gh-stand-in.sh`). The YAML parses, but `actionlint` was not available, and **the workflow has not yet run on GitHub**.

What this still does not do: nothing wakes an agent by itself; the issue waits for a person or for an agent that is assigned to it.

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
- A price playground has `view: {"type": "price_ranking"}` and `data.price_pages` (product, metrics, features, vendors). `notes` is shown under its title. Its metrics and features are its controls, because the extraction reads the pricing pages with their descriptions. One view per playground.

Validation at creation (`lib/kit.ts`, `lib/spec.ts`) rejects: an unknown control type or field, a control nothing uses, a `{{binding}}` or `clay.values.x` to a control that does not exist, an output that references a missing control or none, an initial value outside its range or off its step grid, script tags in the html, sizes over the limits, bad ids, price and preview parts in one spec. Every output is rendered once at the initial values and returned. The preview code cannot run on the server: the create result says "unverified", the page reports to the store whether the code ran in the owner's browser, and `read_playground` returns the error so the agent can repair it with `revise_playground`.

### The preview sandbox

Preview code comes from an agent and is shown to every visitor of the link, so it is untrusted. It runs only in the document that `lib/frame.ts` builds and `GET /p/<id>/frame` serves.

What it enforces:

- **Opaque origin.** The response carries `Content-Security-Policy: sandbox allow-scripts; ...`, and the iframe has `sandbox="allow-scripts"`. The header applies however the URL is opened, also directly in a tab. The preview cannot read Clay's cookies, `localStorage`, `sessionStorage`, IndexedDB or the DOM of the page around it. No forms, popups, top navigation, modals, downloads or workers.
- **Network, by policy.** `default-src 'none'`, `connect-src 'none'`: the policy refuses fetch, XHR, WebSocket and beacon requests. It does not cover every request a running script can cause (resource hints, see the table of routes below), so a preview is network-capable authored code, and the label next to it says so. Scripts: inline code, and the pinned Tailwind build when `view.tailwind` is set (with Subresource Integrity). Images: `data:` URLs and the https hosts of the brand's logos. `frame-ancestors 'self'`: other sites cannot embed the frame.
- **A validated bridge.** The only channel is `postMessage`. The page accepts a message only from the frame's own window, from an opaque origin, in one of two shapes (`ready`, `error`); it reads two fields and cuts the error text to 500 characters. More than 30 messages in 10 seconds stops the preview and removes the frame. The frame accepts values only from its parent window and only when every control gets a value it can have. Nothing the frame sends can settle a result or write to the store, except the error text (cut, stored as data, shown to the agent).
- **Limits.** html 20,000, css 20,000, js 40,000 characters; 12 controls; 6 outputs.
- **Navigation.** Every page except the frame document sends `Content-Security-Policy: frame-src 'self'` (`next.config.ts`; the sign-in and sign-up pages also allow `https://challenges.cloudflare.com`, Clerk's bot check). It is on every page because a client-side navigation keeps the policy of the page the visitor landed on. The browser checks every navigation of the frame against it, also one that the preview starts itself, so the frame cannot be navigated to another host, also not to a URL that answers 204 (which keeps the document and fires no second load). A navigation inside Clay's own origin is allowed; the page removes the frame on its second load. `GET /p/<id>/frame` answers 403 unless the browser marks the request as a same-origin iframe (`Sec-Fetch-Dest`, `Sec-Fetch-Site`), so the preview never runs as a top-level page or in another site's frame, where that policy would not apply.
- The page labels the preview as built by the owner's agent.

`node scripts/sandbox-check.ts http://127.0.0.1:<port>` runs hostile preview code in a real browser and checks each of these (34 checks; no Context.dev request).

What it does not protect against:

- **What a preview can know.** The frame document and the bridge carry: the controls (ids, types, ranges, toggle and option texts), the values (the owner's current values for the owner, the initial values for everyone else), view.html, view.css and view.js, and the declared data (data.brand: domain, title, colours, logos; data.inline; data.web: the values read). The frame's own address names the playground id. Nothing about the viewer is in it: no user id, session, key, email, exploration or settled result; the frame has an opaque origin and cannot read Clay's cookies.
- **Who runs another person's preview.** A private playground's frame is served only to its owner and the admin (`canRead()`, tested in `lib/accounts.test.ts`; the frame route checks it). Another person's code reaches a visitor only through an example, and only the operator marks examples; the landing page embeds and lists examples only.
- **Routes out of a preview** (Chromium, `scripts/sandbox-check.ts`; "policy" is the frame's CSP or sandbox, "best effort" is the frame's bootstrap, `HARDEN` in `lib/frame.ts`, which an author in the same realm might find a way around):

  | Route | Status |
  |---|---|
  | fetch, XHR, WebSocket, EventSource, sendBeacon, workers | blocked by the policy (`connect-src`, `worker-src`) |
  | Images, fonts, media, objects, nested frames | blocked by the policy (`img-src` data: and the brand's logo hosts, `font-src`, `media-src`, `object-src`, `frame-src 'none'`) |
  | Forms, popups, top navigation, storage, cookies | blocked by the sandbox (opaque origin, `sandbox allow-scripts`) |
  | Navigating the frame to another host | blocked by the embedding page's `frame-src 'self'` |
  | `<link>`, `<meta http-equiv>`, `<base>`, `<iframe>`, `<object>`, `<embed>` in view.html | refused when the playground is created or revised |
  | Resource hints (prerender, prefetch, preload, modulepreload, dns-prefetch, preconnect) added from script, through createElement, innerHTML, outerHTML, insertAdjacentHTML, DOMParser, templates, Range.insertNode, custom elements, or an element whose own localName is shadowed | blocked best effort |
  | Scripts added from script (speculation rules) | blocked best effort (creating scripts is refused; a parsed or cloned script stays inert) |
  | WebRTC (STUN) | blocked best effort (removed) |
  | Image requests to the brand's logo hosts | open by design (named in the label) |
  | Speculation rules through a parsed script insertion | open; no request was observed in Chromium |
  | Other browsers, and routes not listed here | not verified |

- **Outgoing requests from preview code.** The frame's Content-Security-Policy and the page's `frame-src 'self'` do not stop every request a running script can cause: a resource hint (`<link rel="prerender">` or `prefetch`) made Chromium request an outside URL carrying control values and inline data (third security review). Clay refuses such elements in view.html and blocks the ways to add them from script in the frame's bootstrap (`lib/frame.ts`); that is best effort, not a guarantee, because browsers offer no complete block for hint-based requests from a document that runs scripts. So the label next to every preview says it: code written by the playground's author can make outgoing requests in some browsers, and what the visitor sets there and the data in the preview could reach a server the author chose, with the visitor's IP address. A private playground runs only for its owner, whose own agent wrote the code; another person's code reaches a visitor only when the operator marks it as an example.

- **What the preview shows.** The frame can display anything inside its box, for example a fake sign-in form (it cannot submit a form, but it can show text that asks for a secret). The label says who built it; nothing checks the content.
- **Image requests to the brand's logo hosts.** `img-src` allows the https hosts of the brand's logos, so the preview can request any URL on those hosts, and the URL can carry the control values, the brand data and `data.inline`. When the agent picks the brand domain, it also picks those hosts. The label next to the preview names this, and that the hosts see the visitor's IP address.
- **Navigations inside Clay's origin.** `frame-src 'self'` allows them. They reach only Clay, carry no Clay cookie (the frame has an opaque origin) and change nothing, because Clay's GET routes are read-only. A redirect from there to another host is checked against the same policy. After a client-side navigation from the sign-in page, Cloudflare's bot-check host stays allowed until the next full page load.
- **Other browsers.** That the embedding page's `frame-src` stops a navigation the frame starts itself was verified in Chromium (`scripts/sandbox-check.ts`), not in Firefox or Safari. `GET /p/<id>/frame` requires both `Sec-Fetch-Dest: iframe` and `Sec-Fetch-Site: same-origin` and fails closed: a browser without Fetch Metadata (Safari before 16.4, Firefox before 90, Chrome and Edge before 76) sees "Preview unavailable in this browser" inside the frame instead of the preview; the controls and outputs still work.
- **CPU and memory.** An endless loop or a heavy animation runs in the visitor's browser. Chromium isolates a sandboxed frame in its own process; other browsers may freeze the tab. The page marks a preview that does not become ready in 10 seconds as failed, but cannot stop its script.
- **The CDN.** With `view.tailwind`, the visitor's browser fetches the Tailwind build from jsDelivr. Subresource Integrity stops a changed file; it does not hide the request from the CDN.
- **Browsers without CSP `sandbox` support** in the header (none of the current ones) would rely on the iframe attribute alone.

### Why Streamable HTTP inside the app

The official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.2) has `WebStandardStreamableHTTPServerTransport`, which takes a web `Request` and returns a `Response`. That is exactly a Next.js route handler, so `app/api/mcp/route.ts` is 20 lines: a fresh server and transport per request, stateless, JSON responses. The tools call `lib/` directly in the same process, so there is no second server, no HTTP hop and no second copy of the validation. A stdio server would need its own process and would have to call the app over HTTP for every tool.

### Access guard

`refused()` in `app/api/respond.ts` is awaited by every route that changes state or spends Context.dev requests (`const no = await refused(req); if (no) return no;`). It checks the origin, the caller (see Accounts: a visitor is refused, a route under `/api/p/<id>/` needs the owner of that playground or the admin, `ADMIN_ONLY` routes need the admin) and:

- The owner key (`lib/access.ts`, `CLAY_ACCESS_KEY`): `Authorization: Bearer <key>` from an agent, or the owner cookie in a browser. Keys are compared in constant time. With no key configured only the development server is open (`pnpm dev` binds to 127.0.0.1); a production build, Vercel, or an app with `PUBLIC_BASE_URL` refuses every write. A key shorter than 32 characters matches nothing.
- The origin: a request that carries an `Origin` header must come from the app's own page, and the app must be addressed by its own name. So a web page open in the person's browser cannot spend requests or overwrite the saved decision.

Public without a key: the pages, `GET /api/p/<id>/state` and `GET /api/playgrounds` (examples only, and the caller's own), the demo vendor pricing page (Context.dev must read it) and the webhook route, which is protected by its signature check.

### Trust boundaries

- A playground spec is untrusted input. `lib/spec.ts` checks it, with `lib/config.ts` for the price part (sizes, types, id formats, https-only pricing URLs on public host names, 2 to 6 vendors, 1 to 5 metrics, up to 6 features, ordered ranges) and `lib/kit.ts` for the preview part. Unknown keys are rejected.
- Preview code is untrusted content: see "The preview sandbox".
- Brand data (title, colour names) is text from the web: cut short, marked in tool results, and never placed in markup unescaped.
- Text scraped from web pages is untrusted data. In tool results it is cut short (plan names 60 characters, quotes 120) and marked: quotes are in fields named `untrusted_web_quote`, and every result that contains page text carries a note that says so.
- Tool errors say how to fix the call (which ids exist, which field is wrong).

## How it works

1. Collect: Context.dev Search finds each vendor's pricing page unless the config gives the URL. Context.dev Scrape (`formats.json` with a JSON Schema generated from the config, `maxAgeMs: 0`) returns the structured pricing model and the page text of the same capture. Every fact keeps its source URL, its fetch time and a verbatim quote. A missing fact stays `null` and is shown as unknown. When that page cannot be read or gives no price, the next pages are tried, at most three per vendor: search results that are the pricing page of the main site, then the site's own `/pricing` page (`pricingCandidates()` in `lib/domain.ts`). When none gives a price, the source says what was tried and why each page failed.
2. Guard: each extracted number is checked against the page text of the same capture. A number that is not on the page is quarantined: it is shown, but never used in a cost.
3. Playground: the controls come from the config and the extracted data. Every move recomputes the cost per vendor, the ranking and the crossover points in the browser. After the person pauses, the browser reports the range tried and the final value per control; that summary is for the agent.
4. Standing decision: the saved state is the assumptions, the chosen vendor and a tolerance. Rule: the decision holds while the chosen vendor can be fully priced under the saved assumptions and costs at most the tolerance (dollars per month, default 0) more than the cheapest fully priced vendor. `stand()` in `lib/pricing.ts` is the one implementation (`standing()` in `lib/diff.ts` wraps it); the screen, the change verdict and the agent tools all use it.
5. Change detection: a webhook from a Context.dev page monitor, the "Re-check" buttons, the agent's `recheck_playground` and a publish of the demo page all call the same `recheck()`. Nothing is re-checked on a timer. It reads the page text (1 credit) and compares its hash. Only when the text changed, it extracts again (5 credits) and diffs the facts.
6. Confirmation: extraction is not deterministic. A change on a real source is recorded only when a second fresh extraction reports it too. A fact changes only when both reads state the same thing: `confirmed()` in `lib/diff.ts` keeps the old state of every plan price, meter and feature on which the two reads differ. While such a part exists, the source shows a note and the next re-check reads the page again. When the second read fails, nothing of the first read is stored. On localhost the app reads the demo page itself and needs no confirmation; on a deployment Context.dev reads the demo page like any other source.

## Layout

- `lib/` has no Next.js or React imports: `spec.ts` (the spec an agent writes, and its validation), `kit.ts` (preview kit: controls, templates, values, exploration), `frame.ts` (the sandboxed frame document, its policy and the bridge), `reference.ts` (the kit reference and its two worked specs), `domain.ts` (the Domain type, the seed, the extraction schema), `config.ts` (validation of the price part of a spec), `contextdev.ts` (API client, request pacing, webhook verification), `pipeline.ts` (create, revise, collect, evidence guard, re-check), `pricing.ts` and `diff.ts` (pure computation), `explore.ts` (exploration summary), `report.ts` (what the agent sees), `mcp.ts` (the MCP server and its tool descriptions), `store.ts` (one JSON document: a local file in development, a private Vercel Blob with conditional writes on a deployment; also the daily budget), `access.ts` (the owner key check), `accounts.ts` (the caller, the access rules, agent keys and limits), `demo.ts` (demo vendor page content).
- `app/page.tsx` is the landing page: what Clay is, an example to try in place, the examples, and "Your playgrounds" for a signed-in person. `app/connect` is "Connect your agent". `app/sign-in`, `app/sign-up` are Clerk's forms. `app/p/[pg]/page.tsx` shows `app/playground.tsx` (price) or `app/kit.tsx` (preview); `app/p/[pg]/frame` serves the sandboxed preview document. `app/api/p/[pg]/*` are thin routes per playground. `app/api/mcp` is the MCP endpoint. `app/demo-vendor/pricing` is the demo vendor's pricing page. `app/enter` and `app/api/access` turn the owner link into the owner cookie.
- `scripts/person.ts` acts as the person on a price playground in a headless browser, `scripts/person-kit.ts` on a preview playground. `scripts/sandbox-check.ts` runs hostile preview code against the sandbox. `scripts/mcp-call.sh` sends one MCP tool call. `scripts/fixture-api.ts` is a local stand-in for the Context.dev scrape endpoint, for checks that must not spend requests. `scripts/webhook-test.ts` signs requests as the Context.dev docs specify. `scripts/transcript.py` prints a `claude -p` stream-json transcript in a readable form.

## Limits you should know

- **Examples publish their story.** Marking a playground as an example makes it open to everyone. For a price playground that includes its saved decision, the tolerance, the verdict and the change history. The owner's exploration, the control positions they left and a preview's settled result are never sent to anyone else: one projection (`nonOwnerView()` in `lib/report.ts`) feeds the page, the frame and the MCP report for a non-owner, and another person's agent is told that the example is not theirs.
- **An example shows what the operator approved.** The mark carries the version of what a visitor sees (a hash of that same projection, returned by `GET /api/p/<id>/state`), and is refused while web reads of the playground run. After the mark, only the operator changes a person's example: a write by its owner, by work the owner started, or by a webhook monitor is discarded inside the store update, and the owner's agent is told (`published_example_kept`); the owner's revision unpublishes it instead. An example that the operator owns, such as `auth-providers`, keeps changing with its vendors' pages by design: a monitor's re-check updates it, and the new numbers pass the same extraction checks as on a build (found in the page text, confirmed by a second extraction).
- **Outputs are bounded.** All outputs of a preview playground together may hold at most 32,000 characters (`OUTPUT_LIMIT`, `lib/kit.ts`). A spec that could exceed it at any values is refused with the size it would reach; rendering measures the size before it builds anything.
- **The caps count requests sent.** `CONTEXT_DEV_DAILY_CAP` and `CLAY_USER_DAILY_REQUESTS` reserve each attempt right before it is sent, retries after a rate limit included; at the cap nothing more is sent. Worst cases in requests sent, each counted: a price build or revision 96 (6 vendors, up to 4 page attempts each, each tried up to 4 times after rate limits), a price re-check 72 (6 vendors, page text and two extractions, 4 tries each), a preview build 52 (the brand, and 6 web sources with search and extraction, 4 tries each), a web re-check 72. The person's cap of 40 stops any of them earlier.
- **Test accounts look, they do not build.** On a public app an account whose only verified addresses are Clerk test ones may sign in and look, but neither its agent key nor its browser session may create, change, re-check or spend (one rule, confirmed with Clerk at most every 10 minutes).

- New free Context.dev accounts allow 10 requests per minute. The client waits for a free slot (`CONTEXT_DEV_REQUESTS_PER_MINUTE`, default 10; 0 turns the wait off), so a large build or a build followed by a repair can take up to 2 minutes. The agent's tool call does not wait that long: see "A build answers within 20 seconds" below. A request that Context.dev still answers with 429 RATE_LIMITED (the account's limit is shared by every instance and person) is sent again after the wait the API states, up to 3 times.
- `CONTEXT_DEV_DAILY_CAP` (default 300, 0 turns it off) caps the Context.dev requests per UTC day. The count is kept in the store. At the cap, a call fails with a message that says so, for the person and for the agent, and no request is sent.
- `CONTEXT_DEV_REQUEST_CAP=<n>` is an optional hard cap on the number of requests logged in `run/requests.jsonl` (local development only).
- The pricing model is "base price plus metered usage with included quantities and graduated tiers, plus features". A price that a page shows only through an interactive slider or calculator cannot be read from its text; the page then names that as the unknown, and never takes the number the slider happens to show. "Unlimited" on a plan is read as no charge for that metric. A vendor whose page lists separate products (GPU models, instance sizes) is priced by its cheapest product that fits, and the page says that the ranking is not like-for-like. Transactional email and hosting extract well; error-tracking pages with volume sliders stay partly unknown.

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
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk sign-in. Without both, accounts are off and only the owner key works. |
| `CLAY_USER_DAILY_REQUESTS`, `CLAY_USER_PLAYGROUNDS` | Optional. Limits per person, default 40 and 20. |
| `CLAY_MAX_PLAYGROUNDS`, `CLAY_MAX_STORE_BYTES` | Optional. Deployment-wide bounds for people's new playgrounds, default 2,000 and 10,000,000 characters; the operator is not bound. |
| `CLAY_USER_STORE_BYTES` | Optional. Characters per person over their own playgrounds, default 600,000; 0 turns it off. |
| `CLAY_ACCESS_KEY` | The owner key: random, 32 bytes or more. Secret. Without it a deployment refuses every write. |
| `BLOB_READ_WRITE_TOKEN` | Set by Vercel when the private Blob store `clay-store` is connected. `BLOB_STORE_ID` works too. Either one switches the store from the local file to the blob. |
| `CONTEXT_DEV_DAILY_CAP` | Optional. Context.dev requests per UTC day, default 300. |
| `CONTEXT_DEV_REQUESTS_PER_MINUTE` | Optional. Request pacing per function instance, default 10. |
| `PUBLIC_BASE_URL` | Optional. The public https origin. On Vercel it defaults to `https://$VERCEL_PROJECT_PRODUCTION_URL`. It is used for playground URLs, webhook URLs and the demo page URL. Setting it makes the owner key mandatory. |
| `MONITOR_INTERVAL_MINUTES` | Optional. Interval of new webhook monitors, 10 or more; the API default is one run per day. |

- Storage: one private Vercel Blob document (`clay/store.json`). It holds the webhook secrets, so the store is private. Reads bypass the CDN cache. Every write is conditional on the version that was read (the MD5 of the document, which is the blob's ETag); a writer that loses re-reads and applies its change again.
- Function duration: the routes that read pricing pages set `maxDuration = 300` seconds. Vercel Pro allows 800 seconds with fluid compute; a build takes 10 to 120 seconds, and goes on in the same function after the agent's tool call has answered (`after()` in `app/api/mcp/route.ts`), so 300 seconds is also the longest a build can run.
- Webhook URL: `<public base URL>/api/webhooks/context/<playgroundId>/<sourceId>`, set per monitor by "Start webhook monitors". A page monitor run costs 1 Context.dev credit.
- Known limits: request pacing and the re-check queue are per function instance (see the `lean:` comments in `lib/contextdev.ts` and `lib/pipeline.ts`). `run/requests.jsonl` logging is skipped where the filesystem is read-only.

## Live web facts for any playground (`data.web`)

The price engine answers "which vendor or plan of one usage-priced product". It cannot express "which GPU" or "which model for our workload", where a live price must be multiplied by the person's own numbers. For those, a preview playground names the facts it wants from web pages, and its own code does the arithmetic:

```json
"data": {
  "inline": { "models": [{ "model": "claude-opus-5-5", "input_tokens_per_task": 67169, "cached_input_tokens_per_task": 60546, "output_tokens_per_task": 2360, "pass_rate": 1 }] },
  "web": [{
    "id": "anthropic",
    "url": "https://docs.anthropic.com/en/docs/about-claude/pricing",
    "rows": { "describe": "one row per Claude model of the API", "fields": [
      { "id": "model", "type": "text", "describe": "model name" },
      { "id": "input", "type": "number", "unit": "USD per 1M tokens", "describe": "price of base input tokens per million" },
      { "id": "cached_input", "type": "number", "unit": "USD per 1M tokens", "describe": "price of cache hits per million" },
      { "id": "output", "type": "number", "unit": "USD per 1M tokens", "describe": "price of output tokens per million" }
    ] }
  }]
}
```

- **What an agent may ask for** (`lib/web.ts`, `checkWeb`): at most 6 sources; each is a public https page (`url`, or `domain` with `find`, which search resolves) and either single `fields` or a table of `rows`; at most 20 fields per source, 60 rows, 200 characters per text value. Every collection is bounded before validation.
- **The guard** (`guard`): Context.dev extracts the facts with a JSON Schema built from the source. A number that is not in the page text of the same capture is quarantined: the preview gets `null`, and the page and the agent see what was extracted and that it was not used. A missing fact is `null`. Text from a page is cut and stays data.
- **In the preview**: `clay.data.web.<id>` is the fields (an object) or the rows (a list). The tool texts and `kit_reference` tell the agent to show `null` as unknown, never as 0, to keep the person's own measurements in `data.inline`, and to return the choice through a select control.
- **On the page**: "Where the data comes from" lists each source with its link, the read time, every value, what was quarantined, and what changed since the person settled.
- **Building**: as for prices, the create call answers within 20 seconds; sources arrive as tracked work; the page asks the server again while data is being read and loads the preview again when it arrives (also for a late brand read). `read_playground` reports per source what was read, what is unknown and what failed, with the repair.
- **Staying live**: `recheck_playground` on a preview reads each page's text and compares its fingerprint; only when the text changed it extracts again, and a fact changes only when two fresh extractions agree. Each change is stored with the old value, the new value and the time. `read_playground` returns `web_changes`: what changed since the person settled. Clay has no rule for what a change means: the person's agent judges whether the settled result still holds.
- **Accounting**: every read goes through the same client as the price engine, so it counts against the person's and the deployment's daily caps. A build of n sources costs n extractions (plus a search per source without a `url`); a re-check costs one text read per source, and up to two extractions for a source whose page changed.

`evals/` has four cases of kind `data` for it. Their checks: the page lists web sources with a link and values read; with every web number missing the preview says "unknown" and shows no broken number (the checker alters the frame document on its way to the browser; nothing is stored); the choice the person settled is written into the file.

## Tested with

From a clean home (no operator configuration), a real signed-up test person, a personal key and the exact command from `/connect`:

- Claude Code 2.1.321, default model (Claude Opus 5.5): 6 of 8 first requests from a clean home with a personal key (8 of 8 in an earlier round). In every case that needed a playground the agent built one. One failure was our test harness; in the other the agent's slider did not reach the largest number the person had mentioned.
- Claude Code with Claude Sonnet 5.5: 7 of 8. In the failed case the agent wrote the settled values into the file but also restructured the code on its own.
- Codex CLI 0.167.0, default model (gpt-6.1-sol): 8 of 8, unprompted. With `codex exec`, add `default_tools_approval_mode = "approve"` and pass `-s workspace-write`.

Each line is 8 fixed vague requests, one run each, with a simulated person settling in their own browser session, on a local server with fixture web data. The same measurement confirmed that `--scope user` makes Clay available in other folders.

With the agent's normal tools on (shell, web search, file tools; `evals/` with `--tools normal`, clean home, first answer only, one run each): Codex CLI 0.167.0 built a playground in 7 of 7 vague requests that should get one, and Claude Code 2.1.321 (Claude Opus 5.5) in 3 of 7. Neither built one for the 3 requests that need none. The lines above and the earlier measurements in this section gave the agent Clay and file tools only, so they measure Clay, not whether an agent with other ways out thinks of Clay. The optional standing instruction under "Connect your agent" closes that gap for Claude Code: 12 of 12 on the four requests it otherwise missed.

The whole set with the agent as it really is (`evals/` with `--tools normal`, clean home, both legs, one run per case, Claude Code 2.1.321 with Claude Opus 5.5, the standing instruction in the project's `CLAUDE.md`, on 2026-11-14 against `6251732`): 23 of 24 main requests and 2 of 6 held-out requests pass every check on the first try. Next to it, the same set with Clay and file tools only and no standing instruction: 24 of 24 and 4 of 6. On the seven requests where the agent has an easy way around Clay, with normal tools and both legs: 4 of 7 without the standing instruction, 7 of 7 with it. Codex CLI 0.167.0 with normal tools and the lines in `AGENTS.md`: 8 of 8 on the eight clean-home requests.

- The five failures, by cause: twice our simulated person chose the same colour for background, text and accent, and the agent refused to write that (the harness; both pass on a re-run with a person who varies the choice). Twice the agent's settled output held a line that is not code, such as `/* ...unchanged... */` (the agent; the outputs rule now forbids it, and both pass on a re-run). Once a replay toggle changed only the animation, which the control check cannot see.
- With the standing instruction no agent searched the web, started a server, or edited a file before the person had settled, in 27 build and return cases. Without it, in 7 cases: one edited the file before any playground, two answered from web pages they fetched, and two fetched pricing pages after the build.
- Web data: live Context.dev for the four `data` requests, fixture pages for the rest. An agent with web access notices fictional fixture numbers, so the `data` requests cannot be measured on the fixture.

Measured with `evals/` on 2026-11-14 against a local server of `master`:

- **Claude Code 2.1.321, Claude Opus 5.5** (`claude -p`): the full set of 20 requests and the 6 held-out ones. The numbers are in the run reports under `evals/out/`.
- **Codex CLI 0.167.0, its default model** (`codex exec`): a sample of 5 requests. Price playgrounds (build, repair, read-back of the saved decision) and preview playgrounds (build from the real file, settle, read-back) worked as with Claude Code. Two things differ:
  - `codex exec` cannot ask for approval, so every Clay tool call is refused ("MCP tool call requires approval, but approval policy is never") unless the server entry says `default_tools_approval_mode = "approve"` (`codex mcp add` writes the entry; add that line to it in `~/.codex/config.toml`, or pass `-c mcp_servers.clay.default_tools_approval_mode="approve"`). In the interactive Codex the person approves the call.
  - Codex loads the operator's `~/.codex/AGENTS.md` whatever the flags. On the test machine that file forbids edits in a shared checkout, and Codex then refused to write the settled result into the file in 2 of 3 cases. Those results say nothing about Clay; measure Codex on a machine or account without such rules.
- Both clients cut an MCP tool call at about 60 seconds. Every Clay tool answers within about 20 seconds (see below), so neither client's default needs to be raised.

## A build answers within 20 seconds

Claude Code and Codex cut an MCP tool call at about 60 seconds, and a cut call looks like a failure although the server finished. So `create_playground`, `revise_playground` and `recheck_playground` wait at most 20 seconds (`CLAY_TOOL_WAIT_MS`) for the pricing pages and then answer with `build.status`: `done`, or `running` when pages are still being read. The reads go on in the background; the MCP route keeps the function alive for them with Next.js `after()`, within `maxDuration` (300 s). Meanwhile:

- the playground URL works at once: the page says "Reading the pricing pages: n of m read", shows each vendor as it arrives, and reloads its state every 3 seconds until the build ends;
- `read_playground` waits up to 20 seconds while a build runs and returns `build` and the `problems` list, so the agent repairs after an early answer exactly as after a complete one;
- a build that was cut off (its function instance ended) shows as `stalled`: the page says which vendors are missing, and "Collect pricing pages" or `recheck_playground` reads them.

A build that ranks fewer than two vendors at the starting values starts its `problems` with `BROKEN BUILD` and names the metric to rewrite or remove. A preview playground needs no web read except the brand, and is stored before the brand is read.

Limits of a create (`lib/spec.ts`, `lib/store.ts`): the request body is bounded (200 KB for a spec), every collection of a spec is checked against its bound before any element is validated, at most 20 problems are returned, the per-person playground cap is checked inside the store update that inserts the playground, and a taken id never fails a create: the playground gets the id with a short suffix, and the result says so.

## Evals: does Clay just work?

`evals/` measures the first-try pass rate of real agents on 24 fixed, vague requests (`evals/requests.ts`): 6 price decisions, 5 look and 4 feel cases on real code (they need the kit and are skipped on a server without it), 4 data cases (live web facts times the person's own numbers: which model, which GPU, a per-seat plan, a question that needs facts of one page), 3 cases where no playground is right, and 2 return visits. For each case the runner starts a headless agent (`claude` or `codex exec`) with only Clay's MCP tools and file access to one scratch directory, then an objective checker (no model as judge) reads the transcript and opens the playground in headless Chromium as the person: did the agent build when it should, did the build succeed, does the page load without errors, does every control change something visible, do the ranges fit the numbers the person gave, and after the person settles, did the agent read the result back.

```bash
node --test evals/check.test.ts     # the checker's pure parts
node evals/selftest.ts              # the checker must fail broken fixture pages for the right reason
# The whole set, against a server and an agent key (a local dev server needs no key):
CLAY_ACCESS_KEY=<key> node evals/run.ts --base-url https://clay-steel-nu.vercel.app
CLAY_ACCESS_KEY=<key> node evals/run.ts --base-url https://clay-steel-nu.vercel.app --subject codex
# One case, or one kind:
node evals/run.ts --base-url http://127.0.0.1:43117 --cases price-email
node evals/run.ts --base-url http://127.0.0.1:43117 --kind price,none --concurrency 2 --timeout 600
```

Output: `evals/out/<run id>/report.md` (git-ignored) with the pass rate overall and by kind, one row per case with the first failing check, failures grouped by cause, and a contact sheet of screenshots (`contact.html`). `--one-leg <ids|all>` skips the second leg, `--from <run dir>` re-runs the checker on saved transcripts without starting agents, and `node evals/run.ts report <run dir> <run dir>` merges runs into one report. `node evals/fixture-web.ts <port>` is a stand-in for Context.dev that answers for any playground with fictional prices, for agent runs that must not spend requests (start the app with `CONTEXT_DEV_BASE_URL=http://127.0.0.1:<port> CONTEXT_DEV_API_KEY=fixture CONTEXT_DEV_DAILY_CAP=0`).

Everything that depends on Clay's tool names, tool results and page markup is in `evals/adapter.ts`. Change that file when the tools or the page change. Each agent run uses the person's own model subscription, and a build on a real server spends Context.dev requests.

`evals/heldout.ts` holds 6 more requests that were written after the fixes of the first "just works" pass (`--set heldout`); write new ones for a new pass. The checker waits for a running build to end, as a person would, and it compares only texts when a preview animates on its own.

Use the owner key (`CLAY_ACCESS_KEY`) as the key: the harness also acts as the person in a browser, through the owner link. With a per-person agent key the agent legs work, but the person's steps (save, settle) need a signed-in browser, which the harness does not have yet. Run against a fresh store, or expect a void sample when an agent picks the id of a playground that an earlier run left behind. Each CLI keeps its default tool-call timeout (about 60 s) on purpose: a build that outlasts it is reported as its own failure cause.
