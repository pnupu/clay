import { after } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { refused } from "@/app/api/respond";
import { readText } from "@/app/api/body";
import { buildServer, MAX_MCP_BYTES } from "@/lib/mcp";
import { refuseOversize } from "@/lib/spec";
import { originOf } from "@/lib/pipeline";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * MCP endpoint (Streamable HTTP, stateless): the person's own agent connects here. Each request gets a fresh server and
 * transport, so there is no session to keep, and the answer is plain JSON. Every method needs the owner key as "Authorization: Bearer <key>" (see refused()).
 */
async function handle(req: Request) {
  const no = await refused(req);
  if (no) return no;
  // The body is read with a size bound, and a tool call with an oversized collection is refused here, before the SDK
  // validates its elements (lib/mcp.ts, refuseOversize).
  let request = req;
  if (req.method === "POST") {
    const body = await readText(req, MAX_MCP_BYTES);
    if ("tooLarge" in body) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `The request is larger than ${MAX_MCP_BYTES} bytes. Nothing was read.` } }, { status: 413 });
    let message: unknown = null;
    try {
      message = JSON.parse(body.text);
    } catch {}
    const big = refuseOversize(message);
    if (big) return Response.json({ jsonrpc: "2.0", id: big.id, result: { content: [{ type: "text", text: big.text }], isError: true } });
    request = new Request(req.url, { method: "POST", headers: req.headers, body: body.text });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  // A build answers the agent before every pricing page is read. after() keeps this function alive for the rest of the
  // reads, up to maxDuration (Next.js docs: api-reference/functions/after; on Vercel it uses waitUntil).
  await buildServer(originOf(req), (work) => after(() => work)).connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
