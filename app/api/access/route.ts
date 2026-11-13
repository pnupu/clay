import { COOKIE, cookieValue, isKey } from "@/lib/access";

/** The owner link (/enter#key=...) posts the key here once. The answer sets the owner cookie; the key itself is not stored in the browser. */
export async function POST(req: Request) {
  const key = ((await req.json().catch(() => null)) as { key?: unknown } | null)?.key;
  if (!isKey(key)) return Response.json({ error: "That is not the owner key of this deployment." }, { status: 401 });
  // Secure, except when this app is served over plain http (a LAN address): a browser would drop a Secure cookie there.
  const http = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "http";
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${COOKIE}=${cookieValue(key as string)}; Path=/; Max-Age=2592000; HttpOnly;${http ? "" : " Secure;"} SameSite=Strict` } });
}
