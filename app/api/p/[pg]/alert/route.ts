import { refused, type Ctx } from "@/app/api/respond";
import { ALERT_REFUSED, alertAddress, alertView, plain, sendAlert } from "@/lib/alert";
import { load, publicBase, update } from "@/lib/store";

/**
 * The alert address of one lab (lib/alert.ts): where its owner is told that the saved decision stopped holding or
 * holds again. Owner and operator only (refused()); a visitor or another person gets nothing, also on an example. The
 * answer never holds the address: only its masked form and the result of the last message.
 *   GET                         -> { alert: { address, last } | null }
 *   POST { "url": "<address>" } -> save it (only the two accepted forms); { "url": null } removes it
 *   POST { "test": true }       -> send a test message to the saved address; the answer says whether it was taken
 *   DELETE                      -> remove it
 */
export async function GET(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const p = (await load()).playgrounds[pg];
  if (!p) return Response.json({ error: "Lab not found." }, { status: 404 });
  return Response.json({ alert: alertView(p.alert) });
}

export async function POST(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  const b = (await req.json().catch(() => null)) as { url?: unknown; test?: unknown } | null;
  if (!b || typeof b !== "object") return Response.json({ error: 'Send {"url": "<address>"}, {"url": null} or {"test": true}.' }, { status: 400 });
  if (b.test === true) {
    const p = (await load()).playgrounds[pg];
    if (!p) return Response.json({ error: "Lab not found." }, { status: 404 });
    if (!p.alert) return Response.json({ error: "No alert address is saved for this lab." }, { status: 400 });
    // One test message a minute: the server posts to the address each time.
    if (p.alert.last?.kind === "test" && Date.now() - Date.parse(p.alert.last.at) < 60_000) return Response.json({ error: "A test message was sent less than a minute ago. Wait a minute, then try again.", alert: alertView(p.alert) }, { status: 429 });
    const url = p.alert.url;
    const r = await sendAlert(url, `Sorvi test message: alerts for "${plain(p.domain.question, 120)}" come to this channel. When its saved decision stops holding, or holds again, Sorvi says so here. ${publicBase() ?? new URL(req.url).origin}/p/${pg}`);
    const alert = await update((s) => {
      const a = s.playgrounds[pg]?.alert;
      if (a && a.url === url) a.last = { at: new Date().toISOString(), ok: r.ok, status: r.status, kind: "test" };
      return alertView(s.playgrounds[pg]?.alert);
    });
    return Response.json({ alert }, { status: r.ok ? 200 : 502 });
  }
  if (!("url" in b)) return Response.json({ error: 'Send {"url": "<address>"}, {"url": null} or {"test": true}.' }, { status: 400 });
  const url = b.url === null ? null : alertAddress(b.url);
  if (b.url !== null && !url) return Response.json({ error: ALERT_REFUSED }, { status: 400 });
  const alert = await update((s) => {
    const p = s.playgrounds[pg];
    if (!p) return undefined;
    // A new address starts with nothing told: the next re-check that changes the verdict is the first message.
    if (url) p.alert = { url, told: null, last: null };
    else delete p.alert;
    return alertView(p.alert);
  });
  if (alert === undefined) return Response.json({ error: "Lab not found." }, { status: 404 });
  return Response.json({ alert });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const no = await refused(req);
  if (no) return no;
  const { pg } = await params;
  await update((s) => void (s.playgrounds[pg] && delete s.playgrounds[pg].alert));
  return Response.json({ alert: null });
}
