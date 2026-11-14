import { readFileSync } from "node:fs";
import { join } from "node:path";
import { access } from "@/app/api/respond";
import { frameCsp, frameDocument, requestOrigin } from "@/lib/frame";
import { valuesNow } from "@/lib/kit";
import { nonOwnerView, viewVersion } from "@/lib/report";
import { load } from "@/lib/store";

/** What a browser without Fetch Metadata sees inside the frame: a plain notice, no script, no request. */
const unavailable = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui,sans-serif;margin:16px;color:#333">Preview unavailable in this browser. Clay runs a preview only when the browser says it is shown inside its playground page (Fetch Metadata), which current Chrome, Edge, Firefox and Safari (16.4 or later) do.</body>`,
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } },
  );

/**
 * The frame of the admin's playground page is pinned to the version that page rendered (app/manage.tsx, MarkExample).
 * When the playground changed since, this says so instead of running the newer code: the admin marks only what they saw.
 */
const changed = () =>
  new Response(
    `<!doctype html><meta charset="utf-8"><body style="font:14px/1.5 system-ui,sans-serif;margin:16px;color:#333">This playground changed after this page loaded. Reload the page to see it as it is now.<script>parent.postMessage({clay:1,type:"error",message:"This playground changed after this page loaded. Reload the page, look at it again, then mark it."},"*")</script></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } },
  );

/**
 * The page's text typeface for a data view (view.data, lib/sheet.ts), as a data: URL: the only kind of font the frame's
 * policy loads, so the policy stays as it is. Read once per instance. next.config.ts puts the file into this route's
 * deployment; should it be missing, the data view falls back to the system typeface and nothing else changes.
 */
let figtree: string | null | undefined;
const font = (): string | null => {
  if (figtree === undefined) {
    try {
      figtree = `data:font/woff2;base64,${readFileSync(join(process.cwd(), "public", "fonts", "figtree-var.woff2")).toString("base64")}`;
    } catch (e) {
      // Said once per instance: a data view in the system typeface does not match the page, and nothing else shows why.
      console.warn(`The typeface of a data view could not be read (public/fonts/figtree-var.woff2): ${e instanceof Error ? e.message : String(e)}`);
      figtree = null;
    }
  }
  return figtree;
};

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
  const p = (await load()).playgrounds[pg];
  const k = p?.kit;
  const a = k ? await access(req, pg) : null;
  if (!p || !k || !a?.read) return new Response("Not found", { status: 404 });
  // A pinned frame (the admin reviewing a mark) shows what a visitor will see: the visitor's view and start values.
  const pin = new URL(req.url).searchParams.get("v");
  if (pin !== null && pin !== viewVersion(p)) return changed();
  // Someone else's example starts at its initial values: the owner's current values are theirs (lib/report.ts, nonOwnerView).
  // The address of this app as this browser reached it: a map preview loads its tiles from the tile route under it.
  const origin = requestOrigin(req.url, req.headers.get("host"), req.headers.get("x-forwarded-proto"), req.headers.get("x-forwarded-host"));
  return new Response(frameDocument(k, valuesNow(a.write && pin === null ? k : nonOwnerView(p).kit!), origin, k.kit.preview.data ? font() : null), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": frameCsp(k, origin), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-DNS-Prefetch-Control": "off" },
  });
}
