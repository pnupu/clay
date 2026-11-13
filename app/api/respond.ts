import { NotFound } from "@/lib/pipeline";
import { load, publicState } from "@/lib/store";

export type Ctx = { params: Promise<{ pg: string }> };

/** The state of one playground as JSON, or 404 when it does not exist. */
export function stateResponse(pg: string, error: string | null = null, status = error ? 502 : 200) {
  const s = load();
  if (!s.playgrounds[pg]) return Response.json({ error: `Playground "${pg}" does not exist.` }, { status: 404 });
  return Response.json({ ...publicState(s, pg), error }, { status });
}

export const failure = (e: unknown) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof NotFound ? 404 : 502 });
