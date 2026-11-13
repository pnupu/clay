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
