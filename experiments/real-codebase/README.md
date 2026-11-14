# Clay in a real codebase: a measurement and two prototypes

Experiment of 2026-11-14 on `fefb7ce`. Nothing here is wired into the product: the kit, the MCP texts and the pages are unchanged.

The question: a person works in a real repository and says "build me a playground for this page / this button / this dialog". What does the agent do with today's Clay, how close is the preview to the real thing, and what would be better?

## What is here

| Path | What it is |
|---|---|
| `run.ts` | Driver for one request in a real checkout: Claude Code with normal tools and a clean home, Clay connected, two legs (build, then "ok I'm done, go ahead"). It plays the person between the legs: in Clay's page, or in the app's own route for prototype B. |
| `compare.mjs` | Fidelity check. It finds the same element on the real page and in the playground and compares 25 computed-style properties (colours as painted pixels), and takes both screenshots at one size. |
| `hosted-snapshot/` | Prototype A: `snapshot.mjs` takes a rendered element out of the running app with only the compiled CSS it needs; `GUIDE.md` is the agent guidance. |
| `in-app/` | Prototype B: `clay-playground.tsx` (control panel, Settle), `clay-settle-route.ts` (dev-only route that writes `.clay/settled/<id>.json`), `GUIDE.md` (agent guidance). |

## The two codebases

- Public: [`arhamkhnz/next-shadcn-admin-dashboard`](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) at `3d1d6f4abf4231b258c81da25da1ccbc38d9b954`. Next.js 16.4.6, React 19, Tailwind 4, shadcn/ui, 274 `.tsx` files. It starts without secrets. Every example below comes from it.
- Private: a product monorepo (Next.js 16, Tailwind 4, an API behind sign-in). Only numbers and general words appear here.

Requests (each with the word "playground"): a page, the look of one button ("its states, padding and colours"), and the motion of a dialog ("how it comes in and goes out"). Public targets: the infrastructure dashboard page, its "Cloud provider" button, the ⌘J search dialog.

Conditions: Claude Code, default model, normal tools, a clean home with only a local Clay server (fixture data, no live web requests). For A and B the guide was put into the checkout's `CLAUDE.md`, as the standing instruction of `connect/` is.

## Today's Clay

The agent used Clay in 6 of 6 requests. It never built in the repository. It read the component and wrote a copy by hand into the hosted preview.

| Request | Build | Hand-back | Preview against the real thing | What the hand-back wrote |
|---|---|---|---|---|
| Public, page | 116 s | 84 s | Hand-made copy of the content area. System font instead of Geist. Unicode glyphs and letter badges instead of the SVG icons and logos. No sidebar or top bar. | Right files, Tailwind scale classes. |
| Public, button | 62 s | 60 s | 23 of 25 properties equal. Font family and width differ: the font is not there. | Right file. Raw values: `h-[38px] gap-[9px] rounded-[14px] border-[#d4d4d4] bg-[#fafafa] …` in a project that uses the scale and theme tokens. |
| Public, motion | 76 s | 92 s | Timing equal (100 ms, fade, scale 0.95 to 1). The list has no icons; a grey skeleton stands in for the page behind. | Right file, the project's animation classes, one arbitrary curve. It respected the repository rule not to edit `src/components/ui`. |
| Private, page | 86 s | 85 s | Hand-made copy; no real render to compare with (the page needs sign-in and the API). | Right files, scale classes. |
| Private, button | 83 s | 82 s | Hand-made copy. | Right file; arbitrary bracket values and one hex colour. |
| Private, motion | 97 s | 69 s | Hand-made copy. | The shared dialog component, so every dialog changed. |

Cost as the CLI reports it: 0.78 to 1.30 USD per request for both legs.

One decision in context ran in the private codebase ("which payment provider should we use for our volumes"; the public template has no usage-priced dependency). The agent built a price playground in 50 s, took the present provider and the plan prices from the repository, said that the repository holds no volume numbers and that the sliders start on its estimate, and wrote the decision record into the repository at hand-back. It also said that the prices looked made up. They were: the run used fixture prices.

The hosted preview cannot load a web font (the frame allows no outside resource) and takes at most 20,000 characters of HTML and of CSS. That is why every preview shows the system font and why a page is always a reduced copy.

## Prototype A: a snapshot of the real element in the hosted kit

`snapshot.mjs` opens the running app, takes the element's rendered markup, and keeps only the compiled CSS rules that match it (light and dark), the theme variables, `@property` rules and keyframes. The agent passes that to `create_playground` and binds the controls to classes or variables.

| Request (public) | Build | Hand-back | Fidelity | Hand-back wrote |
|---|---|---|---|---|
| Page | 396 s | 71 s | One project card only: the page's `main` is 92,000 characters of HTML and 38,000 of CSS. On the card 23 of 25 (line height, width: the font is declared but not loaded). Real SVG icons. | Right file, Tailwind classes. |
| Button | 170 s | 40 s | 24 of 25 (width). Five states side by side. | `className="bg-card hover:bg-accent border-input px-4 has-data-[icon=inline-start]:pl-3.5"`: scale classes and theme tokens. |
| Motion | 479 s, 41 turns | not measured | The snapshot is static markup, so the dialog's behaviour is gone. The agent wrote its own script to open the dialog and capture it. | Not measured. |

Cost: 1.26 to 1.97 USD for the two requests that ran both legs; the motion build alone 2.54 USD.

## Prototype B: the playground inside the person's own app

The agent adds a dev-only route (`src/app/clay/<id>/page.tsx`) that renders the real component with fixture data under the app's root layout, wraps it in `ClayPlayground` with 3 to 6 controls, and adds the dev-only settle route. The person opens `http://localhost:<port>/clay/<id>`, moves the controls, and presses Settle. The settled values, the start values and the tried ranges go to `.clay/settled/<id>.json`. At hand-back the agent reads that file, writes the result into the real file, and deletes the playground.

| Request | Build | Hand-back | Fidelity | Hand-back wrote |
|---|---|---|---|---|
| Public, page | 102 s | 58 s | 25 of 25 on two elements, font loaded, real icons and data. | `gap-4` to `gap-6`, `rounded-xl` to `rounded-2xl`, cell padding classes. Right files, typecheck clean, playground removed. |
| Public, button | 151 s | 51 s | The real `Button`. | `<Button variant="secondary" size="lg" className="border-dashed px-2 …">`: props first, then classes. |
| Public, motion | 159 s | 74 s | The real `SearchDialog` with Replay buttons. | `data-open:duration-300 data-open:ease-out … zoom-in-98 … slide-in-from-top-8`. Right file, typecheck clean, playground removed. |
| Private, page | 230 s | 88 s | The real page component with a local fixture for its data requests: no sign-in, no API. | Three scale classes on one line of the right file. |

Cost: 0.88 to 1.04 USD per public request, 1.51 USD for the private one.

Two first-pass runs were lost to the driver, not to the prototype: see "Limits".

## A, B and today side by side

| | Today's kit | A: snapshot in the hosted kit | B: in the person's app |
|---|---|---|---|
| Fidelity | Hand-made copy. 23 of 25 on a button. No project font, no icons, no app shell. | Real markup and CSS. 23 to 24 of 25. No project font. One component, not a page. No behaviour. | The real component: 25 of 25, fonts, icons, dark mode, behaviour. |
| What leaves the machine | A hand-made copy of the component. | The component's real markup, text and compiled CSS. | Nothing. |
| What must run | A browser. | The app's dev server and a headless browser at build time. | The app's dev server while the person plays. |
| Time to a usable playground | 62 to 116 s | 170 to 479 s | 102 to 230 s |
| Hand-back | Right file 6 of 6. Project form 3 of 6: the rest are raw bracket values. | Right file and project form 2 of 2. | Right file and project form 4 of 4; props where the component has them. |
| What breaks | Anything over 20,000 characters; fonts; icons; behaviour is rewritten by the agent. | The size limit; a dialog or menu needs a script; a page behind sign-in cannot be snapshotted. | The app must start. Data and sign-in need fixtures (the agent wrote them in both codebases). Turbopack rejects a linked `node_modules` in a git worktree; `next dev --webpack` works. |
| Sharing | A URL. | A URL. | Local only, or the project's own preview deploy. |
| Decisions on live web data | Yes. | Yes. | No: the facts and the re-check live on the hosted side. |

## Try prototype B by hand

1. Copy `in-app/clay-playground.tsx` to `src/components/clay/` and `in-app/clay-settle-route.ts` to `src/app/api/clay-settle/route.ts` in a Next.js app.
2. Put `in-app/GUIDE.md` into the repository's `CLAUDE.md` (or `AGENTS.md`) with a line that says where the two files are.
3. Ask the agent for a playground. Open the URL it gives. Settle. Say "done".

## Run the measurement

```sh
node experiments/real-codebase/run.ts --repo <checkout> --base-url http://127.0.0.1:<clay port> \
  --home <clean home> --out <fresh run dir> --id page --say "build me a playground to work on the … page" \
  [--memory <file with the guide and the path of the kit files>] [--in-app "npx next dev --webpack -H 127.0.0.1 -p PORT"] \
  [--typecheck "npx tsc --noEmit -p ."]
CLAY_ACCESS_KEY=<key> node experiments/real-codebase/compare.mjs --real <real page url> --play <playground url> \
  --text "Cloud provider" --tag button --out <dir> --name button
```

`snapshot.mjs` and `compare.mjs` need `playwright-core` and a Chromium (`CHROME=<path>`).

## Limits

- One run per cell. These are observations, not rates.
- The driver resets the checkout and stops processes whose working directory is inside it. Run it on a scratch clone only.
- Agents made their own git worktrees in most runs. The driver finds the app directory of the newest `app/clay` route for that reason.
- `claude -p` does not exit while a dev server it started still runs. The driver stops the session after the final result line. An earlier version of that watchdog cut the second leg of two A runs (button was repeated; motion was not) and of two B runs (both repeated).
- An agent in the private scratch clone committed and pushed a branch to the clone's `origin` without being asked. Remove the push URL of a scratch clone before a run.
- The driver's typecheck runs in the main checkout. For the runs in a worktree, the hand-back was typechecked by hand there.
- The fidelity number is about one element at its start values. It says nothing about layout at other widths.
