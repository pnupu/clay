import { requestOrigin, tileOf, tilePathOf, TILES } from "@/lib/frame";
import { publicBase } from "@/lib/store";

const none = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
/** The largest tile that is passed on. A tile of the standard style is a few thousand to about 50,000 bytes. */
const MAX_BYTES = 512_000;
/**
 * A ceiling on the tiles this server instance fetches in one UTC day. A map view is 4 to 12 tiles, and the CDN and the
 * browsers keep each tile for a week, so honest use stays far below it.
 * lean: counted in memory per server instance, not in the store (a store write per tile would cost more than the tile).
 * It stops a loop against one instance, not a spread-out abuse; when map previews get real traffic, count in the store
 * or move to a paid tile host.
 */
const DAILY_FETCHES = 5_000;
const fetched = { day: "", n: 0 };

/**
 * One map tile for a map preview (lib/frame.ts, TILES, says why the tiles come through this app). Public, like the tile
 * it serves: a preview frame is sandboxed and sends no cookie. So that it cannot be used as a general tile source or
 * made to fetch in bulk under this app's name, it answers only:
 * - the one plain address of a tile of the standard grid (no query and no other spelling: each would be a new cache
 *   entry and a new fetch);
 * - an image request: a browser that says what a request is for (Sec-Fetch-Dest) must say "image", as an <img> on a
 *   map does. A browser that sends no such header (plain http on another host than localhost, an old Safari) is served;
 * - while the instance's daily ceiling is not reached.
 * It asks the tile server as its policy requires (this site as Referer, a User-Agent that names the application), and
 * lets the browser and the CDN keep a tile for seven days, so a tile that was shown once is not fetched again.
 */
export async function GET(req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const t = tileOf(z, x, y);
  const url = new URL(req.url);
  if (!t || req.url.includes("?") || url.pathname !== tilePathOf(t)) return none(404);
  const dest = req.headers.get("sec-fetch-dest");
  if (dest !== null && dest !== "image") return none(403);
  const day = new Date().toISOString().slice(0, 10);
  if (fetched.day !== day) Object.assign(fetched, { day, n: 0 });
  if (fetched.n >= DAILY_FETCHES) return none(503);
  fetched.n++;
  // The site as the tile server should know it: the configured public address, else the host this request came to.
  const site = publicBase() ?? requestOrigin(req.url, req.headers.get("host"), req.headers.get("x-forwarded-proto"));
  try {
    const r = await fetch(`${TILES.upstream}/${t.z}/${t.x}/${t.y}.png`, { headers: { "User-Agent": `Clay map previews (+${site})`, Referer: `${site}/` }, signal: AbortSignal.timeout(8_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) return none(502);
    const body = await r.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return none(502);
    return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, s-maxage=604800", Vary: "Sec-Fetch-Dest", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return none(502);
  }
}
