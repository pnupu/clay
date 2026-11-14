import { access } from "@/app/api/respond";
import { frameCsp, frameDocument } from "@/lib/frame";
import { valuesNow } from "@/lib/kit";
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
  // Opened as a top-level page, or framed by another site, that limit would not apply, so the browser gets nothing.
  // A client without these headers (not a browser) runs no script.
  const dest = req.headers.get("sec-fetch-dest");
  const site = req.headers.get("sec-fetch-site");
  if ((dest && dest !== "iframe") || (site && site !== "same-origin")) return new Response("The preview opens only inside its playground page.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const { pg } = await params;
  const k = (await load()).playgrounds[pg]?.kit;
  if (!k || !(await access(req, pg))?.read) return new Response("Not found", { status: 404 });
  return new Response(frameDocument(k, valuesNow(k)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": frameCsp(k), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });
}
