# Live Decision Playground

Built for the Junction 2026 challenge "The Web Is Your Real-Time Database" by Context.dev.

The web supplies sourced data. The person explores a decision with direct controls. The settled decision stays live as the web changes.

The example decision is "Which auth provider should a B2B SaaS use?". The sources are the public pricing pages of Clerk, WorkOS, Supabase Auth and Stytch, plus one clearly labelled demo vendor (Northwind Auth) whose pricing page this app serves, so a presenter can change a price live.

## Start

```bash
pnpm dev
```

This binds to 127.0.0.1 on port 43117. Use `PORT=<port> pnpm dev` for another port. The app needs `CONTEXT_DEV_API_KEY` in `.env.local` (git-ignored). It needs no LLM key.

A full cold start is `rm .data/store.json`, then open the app and click "Collect pricing pages" (about 10 seconds, 8 Context.dev requests, about 24 credits).

## How it works

1. Collect: Context.dev Search finds each vendor's pricing page. Context.dev Scrape (`formats.json` with a JSON Schema, `maxAgeMs: 0`) returns the structured pricing model and the page text of the same capture. Every fact keeps its source URL, its fetch time and a verbatim quote. A missing fact stays `null` and is shown as unknown.
2. Guard: each extracted number is checked against the page text of the same capture. A number that is not on the page is quarantined: it is shown, but never used in a cost.
3. Playground: the controls come from the extracted data. Every move recomputes the cost per vendor, the ranking and the crossover points in the browser, with no network call.
4. Standing decision: the saved state is the assumptions plus the chosen vendor. It is judged against the sources as they are now.
5. Change detection: a webhook from a Context.dev page monitor, the "Re-check" buttons and the watch loop of the demo source all call the same `recheck()`. It reads the page text (1 credit) and compares its hash. Only when the text changed, it extracts again (5 credits), diffs the facts and writes a verdict on the saved decision.

## Layout

- `lib/` has no Next.js or React imports: `domain.ts` (the one domain-specific file: metrics, features, vendors, extraction schema), `contextdev.ts` (API client and webhook verification), `pipeline.ts` (collect, evidence guard, re-check), `pricing.ts` and `diff.ts` (pure computation, with tests), `store.ts` (JSON file store), `demo.ts` (demo vendor page content).
- `app/playground.tsx` is the one screen. `app/api/*` are thin routes. `app/demo-vendor/pricing` is the demo vendor's pricing page.
- `scripts/webhook-test.ts` signs requests as the Context.dev docs specify and posts them to the running app. `scripts/monitor-contract.ts` creates one monitor, reads it, deletes it and confirms the deletion.

## Checks

```bash
pnpm test        # pricing and diff unit tests
pnpm typecheck
pnpm lint
node scripts/webhook-test.ts <port> <sourceId>              # needs the running app
node --env-file=.env.local scripts/monitor-contract.ts      # creates and deletes 1 monitor
```

## Deployment (not done)

- Environment: `CONTEXT_DEV_API_KEY`, `PUBLIC_BASE_URL` (the public https origin; it turns on "Start webhook monitors" and makes Context.dev read the demo page like any other source), optional `MONITOR_INTERVAL_MINUTES` (10 or more; the API default is one run per day).
- Storage: `lib/store.ts` writes `.data/store.json`. Vercel's filesystem is read-only, so `load()` and `update()` need a real store (for example Upstash Redis or Postgres). The webhook secrets must stay in that server-side store.
- Webhook URL: `<PUBLIC_BASE_URL>/api/webhooks/context/<sourceId>`, set per monitor by "Start webhook monitors".
- `run/requests.jsonl` logging is skipped where the filesystem is read-only.
