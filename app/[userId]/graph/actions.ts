"use server";

import { deleteAttachment, listNodeAttachmentViews, type AttachmentView } from "@/lib/attachments";
import { resolveGraphId } from "@/lib/auth";
import { brief, type BriefResult } from "@/lib/brief";
import { logMeeting, type MeetingLogInput, type MeetingLogResult } from "@/lib/meetings";
import { R2NotConfiguredError } from "@/lib/r2";
import { archiveNode, getAllTags, getOrphanIds, searchNodes, type SearchOpts } from "@/lib/nodes";
import { createEdge, deleteEdge } from "@/lib/edges";
import { createNode } from "@/lib/nodes";
import { graphQuery } from "@/lib/graph";
import type { EdgeCreateInput, EdgeType, NodeCreateInput } from "@/lib/types";

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

export async function createNodeAction(token: string, input: NodeCreateInput) {
  return createNode(await graphFor(token), input);
}

export async function archiveNodeAction(token: string, nodeId: string) {
  return archiveNode(await graphFor(token), nodeId);
}

export async function createEdgeAction(token: string, input: EdgeCreateInput) {
  return createEdge(await graphFor(token), input);
}

export async function deleteEdgeAction(token: string, edgeId: string) {
  return deleteEdge(await graphFor(token), edgeId);
}

// Removes the file from storage and from every node it hangs on.
export async function deleteAttachmentAction(token: string, attachmentId: string): Promise<void> {
  const att = await deleteAttachment(await graphFor(token), attachmentId);
  if (!att) throw new Error("That file is already gone.");
}

export type NodeDetail = {
  brief: Extract<BriefResult, { status: "ok" }>;
  attachments: AttachmentView[];
  attachmentsError?: string; // e.g. R2 not configured — the rest of the panel still works
};

// Everything the detail panel shows: fields, meeting timeline, people/groups/topics, files.
export async function getNodeDetailAction(token: string, nodeId: string): Promise<NodeDetail | null> {
  const graphId = await graphFor(token);
  const result = await brief(graphId, nodeId, 100);
  if (!result || result.status !== "ok") return null;
  try {
    return { brief: result, attachments: await listNodeAttachmentViews(graphId, result.node.id) };
  } catch (e) {
    if (!(e instanceof R2NotConfiguredError)) console.error("[vertex] listing attachments failed:", e);
    return {
      brief: result,
      attachments: [],
      attachmentsError: e instanceof Error ? e.message : "Couldn't load files.",
    };
  }
}

export async function logMeetingAction(token: string, input: MeetingLogInput): Promise<MeetingLogResult> {
  return logMeeting(await graphFor(token), input);
}
