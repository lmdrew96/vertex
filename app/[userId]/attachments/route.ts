import { requestUpload } from "@/lib/attachments";
import { resolveGraphId } from "@/lib/auth";
import { confirmAndExtract } from "@/lib/extract";

// Node runtime: confirm runs text extraction (unpdf, Anthropic SDK), which must stay out of
// the edge graph page's bundle. See the bundle rule in CLAUDE.md.
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ userId: string }> };

const fail = (message: string, status = 400): Response => Response.json({ error: message }, { status });

/** Web upload flow: { action: "request", ... } → PUT to uploadUrl → { action: "confirm", attachmentId }. */
export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { userId: token } = await context.params;
  const graphId = await resolveGraphId(token);
  if (!graphId) return fail("This Vertex link is invalid or was replaced. Sign in to get the current one.", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Malformed request body.");
  }

  try {
    if (body.action === "request") {
      const nodeIds = Array.isArray(body.nodeIds) ? body.nodeIds.filter((n): n is string => typeof n === "string") : [];
      const result = await requestUpload(graphId, {
        nodeIds,
        filename: String(body.filename ?? ""),
        contentType: String(body.contentType ?? ""),
        size: Number(body.size),
      });
      return Response.json(result);
    }
    if (body.action === "confirm") {
      const attachment = await confirmAndExtract(graphId, String(body.attachmentId ?? ""));
      return Response.json({ attachmentId: attachment.id, extractStatus: attachment.extractStatus });
    }
    return fail(`Unknown action: ${String(body.action)}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Upload failed.");
  }
}
