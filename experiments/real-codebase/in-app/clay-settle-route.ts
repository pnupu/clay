// Prototype B: the dev-only route that keeps what the person settled, for the agent to read.
// Copy to <app>/src/app/api/clay-settle/route.ts (Next.js App Router). It writes <app>/.clay/settled/<id>.json.
// It answers only in development, only to a request from the page of this same app, and only with a small body.
// The file holds what the page sent: the level (instance, variant or token), `target` and `files` (what the hand-back
// may edit), `uses` (changed, unchanged, changedNotShown), `values`, `initial`, `changed`, `onScale`, `tried`, `outputs`.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Only the page of this app may settle." }, { status: 403 });
  const raw = await req.text();
  if (raw.length > 100_000) return Response.json({ error: "The settled result is too large." }, { status: 413 });
  let body: { id?: unknown; level?: unknown; files?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Not JSON." }, { status: 400 });
  }
  const id = String(body.id ?? "");
  // The id becomes a file name: letters, digits and hyphens only.
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return Response.json({ error: "The id must be lower-case letters, digits and hyphens." }, { status: 400 });
  // The level and its files tell the agent what it may edit: a result that names another level, or no files for a level, is refused.
  if (body.level != null && !["instance", "variant", "token"].includes(String(body.level))) return Response.json({ error: "The level must be instance, variant or token." }, { status: 400 });
  if (body.level != null && !(Array.isArray(body.files) && body.files.length > 0 && body.files.every((f) => typeof f === "string" && !f.split(/[\\/]/).includes("..")))) return Response.json({ error: "The level must name the files it changes." }, { status: 400 });
  const dir = join(process.cwd(), ".clay", "settled");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify({ ...body, settledAt: new Date().toISOString() }, null, 2)}\n`);
  return Response.json({ ok: true, path: `.clay/settled/${id}.json` });
}
