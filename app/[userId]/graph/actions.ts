"use server";

import { archiveNode, getAllTags, getOrphanIds, searchNodes, type SearchOpts } from "@/lib/nodes";
import { createEdge, deleteEdge } from "@/lib/edges";
import { createNode } from "@/lib/nodes";
import { getNodeWithEdges, graphQuery } from "@/lib/graph";
import type { EdgeCreateInput, EdgeType, NodeCreateInput } from "@/lib/types";

export async function searchNodesAction(userId: string, opts: SearchOpts) {
  return searchNodes(userId, opts);
}

export async function getAllTagsAction(userId: string) {
  return getAllTags(userId);
}

export async function getOrphanIdsAction(userId: string) {
  return getOrphanIds(userId);
}

export async function graphQueryAction(
  userId: string,
  opts: { node_id: string; depth?: number; edge_types?: EdgeType[] },
) {
  return graphQuery(userId, opts);
}

export async function getNodeWithEdgesAction(userId: string, idOrName: string) {
  return getNodeWithEdges(userId, idOrName);
}

export async function createNodeAction(userId: string, input: NodeCreateInput) {
  return createNode(userId, input);
}

export async function archiveNodeAction(userId: string, nodeId: string) {
  return archiveNode(userId, nodeId);
}

export async function createEdgeAction(userId: string, input: EdgeCreateInput) {
  return createEdge(userId, input);
}

export async function deleteEdgeAction(userId: string, edgeId: string) {
  return deleteEdge(userId, edgeId);
}
