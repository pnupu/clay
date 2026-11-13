import { COOKIE, cookieValue, isKey } from "@/lib/access";
import { publicBase } from "@/lib/store";

/** The owner link (/enter#key=...) posts the key here once. The answer sets the owner cookie; the key itself is not stored in the browser. */
export async function POST(req: Request) {
  const key = ((await req.json().catch(() => null)) as { key?: unknown } | null)?.key;
  if (!isKey(key)) return Response.json({ error: "That is not the owner key of this deployment." }, { status: 401 });
  // Secure, except when this app is served over plain http (a LAN address): a browser would drop a Secure cookie there.
  // A configured public base URL decides; the request's own scheme is used only without one, because behind a proxy that
  // terminates TLS the request looks like plain http.
  const base = publicBase();
  const http = base ? base.startsWith("http:") : new URL(req.url).protocol === "http:";
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${COOKIE}=${cookieValue(key as string)}; Path=/; Max-Age=2592000; HttpOnly;${http ? "" : " Secure;"} SameSite=Strict` } });
}
