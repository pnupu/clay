import { tileOf, TILES } from "@/lib/frame";
import { publicBase } from "@/lib/store";

const none = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
/** The largest tile that is passed on. A tile of the standard style is a few thousand to about 50,000 bytes. */
const MAX_BYTES = 512_000;

/**
 * One map tile for a map preview (lib/frame.ts, TILES, says why the tiles come through this app). Public, like the tile
 * it serves: a preview frame is sandboxed and sends no cookie. It serves single tiles of the standard grid and nothing
 * else, asks the tile server as its policy requires (this site as Referer, a User-Agent that names the application),
 * and lets the browser and the CDN keep a tile for seven days, so a tile that was shown once is not fetched again.
 */
export async function GET(req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const t = tileOf(z, x, y);
  if (!t) return none(404);
  const site = publicBase() ?? new URL(req.url).origin;
  try {
    const r = await fetch(`${TILES.upstream}/${t.z}/${t.x}/${t.y}.png`, { headers: { "User-Agent": `Clay map previews (+${site})`, Referer: `${site}/` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/png")) return none(502);
    const body = await r.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return none(502);
    return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, s-maxage=604800", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return none(502);
  }
}
