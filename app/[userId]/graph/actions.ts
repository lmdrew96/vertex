"use server";

import { deleteAttachment, listNodeAttachmentViews, type AttachmentView } from "@/lib/attachments";
import { resolveGraphId } from "@/lib/auth";
import { brief, type BriefResult } from "@/lib/brief";
import { getDashboard, type Dashboard } from "@/lib/dashboard";
import { logMeeting, type MeetingLogInput, type MeetingLogResult } from "@/lib/meetings";
import { R2NotConfiguredError } from "@/lib/r2";
import { archiveNode, getAllTags, getNode, getOrphanIds, searchNodes, type SearchOpts } from "@/lib/nodes";
import { archiveEdge, createEdge, deleteEdge, getArchivedEdges, restoreEdge } from "@/lib/edges";
import { createNode } from "@/lib/nodes";
import { getNodeWithEdges, graphQuery } from "@/lib/graph";
import type { Edge, EdgeCreateInput, EdgeType, NodeCreateInput, VertexNode } from "@/lib/types";

// Every action receives the URL token and resolves it to the graph namespace server-side,
// so a rotated-out token can't read or write through the UI either.
const graphFor = async (token: string): Promise<string> => {
  const graphId = await resolveGraphId(token);
  if (!graphId) throw new Error("This Vertex link is invalid or was replaced. Sign in to get the current one.");
  return graphId;
};

export async function searchNodesAction(token: string, opts: SearchOpts) {
  return searchNodes(await graphFor(token), opts);
}

export async function getAllTagsAction(token: string) {
  return getAllTags(await graphFor(token));
}

export async function getOrphanIdsAction(token: string) {
  return getOrphanIds(await graphFor(token));
}

export async function graphQueryAction(
  token: string,
  opts: { node_id: string; depth?: number; edge_types?: EdgeType[] },
) {
  return graphQuery(await graphFor(token), opts);
}

// Production hides a thrown server-action error behind a bare 500, so expected failures
// (like a wrong edge pair) come back as a message the form can show.
export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const asResult = async <T,>(run: () => Promise<T>): Promise<ActionResult<T>> => {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    console.error("[vertex] action failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
};

export async function createEdgeAction(token: string, input: EdgeCreateInput): Promise<ActionResult<Edge>> {
  return asResult(async () => (await createEdge(await graphFor(token), input)).edge);
}

export async function deleteEdgeAction(token: string, edgeId: string): Promise<ActionResult<null>> {
  return asResult(async () => {
    if (!(await deleteEdge(await graphFor(token), edgeId))) throw new Error("That connection is already gone.");
    return null;
  });
}

// Archived edges leave the graph but can come back; delete is the permanent option.
export async function archiveEdgeAction(token: string, edgeId: string): Promise<ActionResult<null>> {
  return asResult(async () => {
    if (!(await archiveEdge(await graphFor(token), edgeId))) throw new Error("That connection is already gone.");
    return null;
  });
}

export async function restoreEdgeAction(token: string, edgeId: string): Promise<ActionResult<null>> {
  return asResult(async () => {
    if (!(await restoreEdge(await graphFor(token), edgeId))) throw new Error("That connection is already gone.");
    return null;
  });
}

export async function createNodeAction(token: string, input: NodeCreateInput): Promise<ActionResult<VertexNode>> {
  return asResult(async () => createNode(await graphFor(token), input));
}

export async function archiveNodeAction(token: string, nodeId: string): Promise<ActionResult<null>> {
  return asResult(async () => {
    if (!(await archiveNode(await graphFor(token), nodeId))) throw new Error("That node no longer exists.");
    return null;
  });
}

// Removes the file from storage and from every node it hangs on.
export async function deleteAttachmentAction(token: string, attachmentId: string): Promise<ActionResult<null>> {
  return asResult(async () => {
    const att = await deleteAttachment(await graphFor(token), attachmentId);
    if (!att) throw new Error("That file is already gone.");
    return null;
  });
}

// One direct edge as the detail panel lists it. `direction` is relative to the panel's node.
export type Connection = {
  edgeId: string;
  type: EdgeType;
  direction: "out" | "in";
  other: { id: string; name: string; type: VertexNode["type"] };
  notes?: string;
};

export type NodeDetail = {
  brief: Extract<BriefResult, { status: "ok" }>;
  connections: Connection[];
  archivedConnections: Connection[];
  attachments: AttachmentView[];
  attachmentsError?: string; // e.g. R2 not configured — the rest of the panel still works
};

// Everything the detail panel shows: fields, meeting timeline, people/groups/topics, files.
export async function getNodeDetailAction(token: string, nodeId: string): Promise<NodeDetail | null> {
  const graphId = await graphFor(token);
  const [result, withEdges, archived] = await Promise.all([
    brief(graphId, nodeId, 100),
    getNodeWithEdges(graphId, nodeId),
    getArchivedEdges(graphId, nodeId),
  ]);
  if (!result || result.status !== "ok") return null;

  const toConnection = (edge: Edge, other: VertexNode): Connection => ({
    edgeId: edge.id,
    type: edge.type,
    direction: edge.from === result.node.id ? "out" : "in",
    other: { id: other.id, name: other.name, type: other.type },
    ...(edge.notes ? { notes: edge.notes } : {}),
  });
  const connections = withEdges
    ? [
        ...withEdges.edges.outgoing.map(({ edge, target }) => toConnection(edge, target)),
        ...withEdges.edges.incoming.map(({ edge, source }) => toConnection(edge, source)),
      ].sort((a, b) => a.type.localeCompare(b.type) || a.other.name.localeCompare(b.other.name))
    : [];
  const archivedConnections = (
    await Promise.all(
      archived.map(async (edge) => {
        const other = await getNode(graphId, edge.from === result.node.id ? edge.to : edge.from);
        return other ? toConnection(edge, other) : null;
      }),
    )
  ).filter((c): c is Connection => c !== null);

  const base = { brief: result, connections, archivedConnections };
  try {
    return { ...base, attachments: await listNodeAttachmentViews(graphId, result.node.id) };
  } catch (e) {
    if (!(e instanceof R2NotConfiguredError)) console.error("[vertex] listing attachments failed:", e);
    return {
      ...base,
      attachments: [],
      attachmentsError: e instanceof Error ? e.message : "Couldn't load files.",
    };
  }
}

export async function logMeetingAction(
  token: string,
  input: MeetingLogInput,
): Promise<ActionResult<MeetingLogResult>> {
  return asResult(async () => logMeeting(await graphFor(token), input));
}

// The signed-in home page: recent meetings and threads.
export async function getDashboardAction(token: string): Promise<ActionResult<Dashboard>> {
  return asResult(async () => getDashboard(await graphFor(token)));
}
