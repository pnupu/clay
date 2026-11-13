import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { refused } from "@/app/api/respond";
import { buildServer } from "@/lib/mcp";
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
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer(originOf(req)).connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
