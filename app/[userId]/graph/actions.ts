"use server";

import { resolveGraphId } from "@/lib/auth";
import { archiveNode, getAllTags, getOrphanIds, searchNodes, type SearchOpts } from "@/lib/nodes";
import { createEdge, deleteEdge } from "@/lib/edges";
import { createNode } from "@/lib/nodes";
import { getNodeWithEdges, graphQuery } from "@/lib/graph";
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

export async function getNodeWithEdgesAction(token: string, idOrName: string) {
  return getNodeWithEdges(await graphFor(token), idOrName);
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
