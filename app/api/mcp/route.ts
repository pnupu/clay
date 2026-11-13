import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/lib/mcp";
import { originOf } from "@/lib/pipeline";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * MCP endpoint (Streamable HTTP, stateless): the person's own agent connects here. Each request gets a fresh server and
 * transport, so there is no session to keep, and the answer is plain JSON. There is no auth: the app binds to 127.0.0.1.
 */
async function handle(req: Request) {
  // A web page in the person's browser must not be able to drive the tools: browsers send Origin, agents do not.
  const origin = req.headers.get("origin");
  if (origin && origin !== originOf(req)) return new Response("Cross-origin requests are not allowed", { status: 403 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer(originOf(req)).connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
