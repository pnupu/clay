import { access } from "@/app/api/respond";
import { frameCsp, frameDocument } from "@/lib/frame";
import { valuesNow } from "@/lib/kit";
import { nonOwnerView } from "@/lib/report";
import type { Playground } from "@/lib/store";

/** What a browser without Fetch Metadata sees inside the frame: a plain notice, no script, no request. */
const unavailable = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui,sans-serif;margin:16px;color:#333">Preview unavailable in this browser. Clay runs a preview only when the browser says it is shown inside its playground page (Fetch Metadata), which current Chrome, Edge, Firefox and Safari (16.4 or later) do.</body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } },
  );
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The preview of a preview playground: agent-supplied code, untrusted. Open to whoever may open the page (an example to
 * everyone, any other playground to its owner and the admin), and inert to this app:
 * the Content-Security-Policy header sandboxes the document (opaque origin, scripts only) and blocks its network access.
 * See lib/frame.ts and the README.
 */
export async function GET(req: Request, { params }: { params: Promise<{ pg: string }> }) {
  // Only as a frame of Clay's own pages: there the page's frame-src (next.config.ts) limits where the frame can navigate.
  // Both Fetch Metadata headers must say so. Missing ones fail closed: a browser that does not send them (or a request
  // that drops them) would get the preview as a top-level page, where no embedding page limits its navigation.
  if (req.headers.get("sec-fetch-dest") !== "iframe" || req.headers.get("sec-fetch-site") !== "same-origin") return unavailable();
  const { pg } = await params;
  const k = (await load()).playgrounds[pg]?.kit;
  const a = k ? await access(req, pg) : null;
  if (!k || !a?.read) return new Response("Not found", { status: 404 });
  // Someone else's example starts at its initial values: the owner's current values are theirs (lib/report.ts, nonOwnerView).
  return new Response(frameDocument(k, valuesNow(a.write ? k : nonOwnerView({ kit: k } as Playground).kit!)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": frameCsp(k), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });
}
