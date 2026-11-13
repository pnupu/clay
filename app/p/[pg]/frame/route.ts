import { frameCsp, frameDocument } from "@/lib/frame";
import { valuesNow } from "@/lib/kit";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * The preview of a preview playground: agent-supplied code, untrusted. Public like the page, and inert to this app:
 * the Content-Security-Policy header sandboxes the document (opaque origin, scripts only) however it is opened, in the
 * frame of the playground page or directly, and blocks its network access. See lib/frame.ts and the README.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ pg: string }> }) {
  const k = (await load()).playgrounds[(await params).pg]?.kit;
  if (!k) return new Response("Not found", { status: 404 });
  return new Response(frameDocument(k, valuesNow(k)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": frameCsp(k), "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" },
  });
}
