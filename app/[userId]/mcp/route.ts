import { resolveGraphId } from "@/lib/auth";
import { SERVER_INFO, TOOLS, ToolError, dispatchTool, err, ok } from "@/lib/mcp";

export const runtime = "edge";

type RouteContext = { params: Promise<{ userId: string }> };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
};

// Malformed or rotated-out tokens get a real 401, not an empty graph.
const unauthorized = (id: unknown = null): Response =>
  Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32001,
        message:
          "This Vertex URL is invalid or was replaced. Sign in at vertex.adhdesigns.dev to get the current one.",
      },
    },
    { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );

// GET — SSE endpoint for server-to-client messages (required by streamable HTTP transport).
// This server has no server-initiated messages; we open the stream and hold it.
// Vercel will close it on function timeout, which is fine — clients reconnect.
export async function GET(req: Request, context: RouteContext) {
  const { userId: token } = await context.params;
  if (!(await resolveGraphId(token))) return unauthorized();

  const stream = new ReadableStream({
    start(controller) {
      // Send an SSE comment to confirm the connection is live.
      controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      // Hold the stream open. Vercel edge will time out and close it naturally.
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function POST(req: Request, context: RouteContext) {
  const { userId: token } = await context.params;
  const userId = await resolveGraphId(token);
  if (!userId) return unauthorized();

  let body: { method?: string; params?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return err(null, -32700, "Parse error: invalid JSON");
  }
  const { method, params, id } = body;

  if (method === "initialize") {
    // Return a session ID so clients that require Mcp-Session-Id are satisfied.
    // We don't track sessions server-side — the server is stateless.
    const sessionId = crypto.randomUUID();
    const res = ok(id, {
      protocolVersion: SERVER_INFO.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    });
    const headers = new Headers(res.headers);
    headers.set("Mcp-Session-Id", sessionId);
    return new Response(res.body, { status: res.status, headers });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method === "tools/list") {
    return ok(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = (params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (!name) return err(id, -32602, "tools/call requires `name`");

    try {
      const result = await dispatchTool(name, args ?? {}, { userId });
      return ok(id, result);
    } catch (e) {
      if (e instanceof ToolError) return err(id, e.code, e.message);
      const message = e instanceof Error ? e.message : "Internal error";
      return err(id, -32603, message);
    }
  }

  return err(id, -32601, `Unknown method: ${method}`);
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}
