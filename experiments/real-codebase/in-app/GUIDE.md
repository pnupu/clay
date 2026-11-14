# A playground inside this app (prototype B)

When I ask for a playground for a page, a component or a motion of THIS repository, build it inside the app, with the real code. Do not copy the component into Clay's hosted preview: a copy is not the thing.

The kit is two files in `KIT_DIR` (the path is at the end of this file): `clay-playground.tsx` (one client component: a stage, a few controls, Settle) and `clay-settle-route.ts` (a dev-only route that writes what I settle to a file).

1. Read the real component, its props, its variants and one place where it is used. Find the app's root layout and providers (theme, fonts, global CSS): the playground must render under the same ones.
2. Copy `clay-settle-route.ts` to `<app>/src/app/api/clay-settle/route.ts` and `clay-playground.tsx` to `<app>/src/app/clay/_kit/clay-playground.tsx`.
3. Add the dev-only route `<app>/src/app/clay/<id>/page.tsx`. First line of the component: `if (process.env.NODE_ENV === "production") notFound();`. Put it where no sign-in or data guard applies (top-level `app/clay/`, under the root layout). Render `<ClayPlayground id title controls outputs>{(v) => ...}</ClayPlayground>` with the REAL component imported from its real path. `ClayPlayground` is a client component and its children is a function, so the file that calls it starts with `"use client"` (put the page body in a client file next to `page.tsx` when the page itself must stay a server component).
4. Data: no network and no sign-in. Give the real component fixture props, or wrap it in a fixture provider, with realistic values copied from the code (names, counts, states). A page that loads data on the server: render its presentational parts with fixtures.
5. Controls: 3 to 6, each one thing I asked about, each mapped to something real: a prop, a variant, a Tailwind class from a short list, or a CSS variable on a wrapper. `initial` is what the code has now, so the page opens on today's look. Show the states side by side when I ask about states (default, hover, focus, disabled, loading: force them with the component's own props, `data-` attributes or classes).
6. Motion: bind duration, easing and distance to the real component's own classes, props or CSS variables, and add a Replay button in the stage.
7. `outputs(v)` returns the code-ready text for the values now, in the project's own form: the class string, the props, the token. It is what you will write at hand-back.
8. Start the dev server in the background if none runs, load the route once with `curl` and check for HTTP 200 and no error in the server log. Then give me the URL and stop. Do not change the real component yet.
9. When I say I am done: read `<app>/.clay/settled/<id>.json` (`values`, `initial`, `tried`: the range I tried, `outputs`). Write the settled result into the real file, in the project's own form. Run the project's typecheck or lint for that file. Then delete `src/app/clay/` and `src/app/api/clay-settle/`, and say what you changed and what range I tried.

Sharing with someone else, and choices that rest on prices or web facts, still go through Clay's hosted playground (`create_playground`).
