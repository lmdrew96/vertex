import { redis } from "./redis";
import {
  adjFromKey,
  adjToKey,
  allEdgesKey,
  archivedEdgesKey,
  edgeKey,
  orphansKey,
} from "./keys";
import { clearConnected, getNode, markConnected, reactivateNode } from "./nodes";
import { EDGE_RULES, edgeFits, edgeTypesFor, type Edge, type EdgeCreateInput, type EdgeType, type NodeType } from "./types";

// The pair rules live in types.ts so the browser can use them without pulling in Redis.
export { EDGE_RULES, edgeTypesFor } from "./types";

// ── Pair rules ───────────────────────────────────────────────────────────────

const describeRule = (type: EdgeType): string => {
  const rules = EDGE_RULES[type];
  return rules ? rules.map((r) => `${r.from.join("/")} → ${r.to.join("/")}`).join(" or ") : "any → any";
};

// Throws with the allowed pair and the edge types that would fit, so the caller can retry.
export const validateEdgePair = (type: EdgeType, from: NodeType, to: NodeType): void => {
  if (edgeFits(type, from, to)) return;
  throw new Error(
    `${type} must go ${describeRule(type)}; got ${from} → ${to}. ` +
      `Edge types that fit ${from} → ${to}: ${edgeTypesFor(from, to).join(", ")}.`,
  );
};

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const createEdge = async (
  userId: string,
  input: EdgeCreateInput,
): Promise<{
  edge: Edge;
  fromNode: NonNullable<Awaited<ReturnType<typeof getNode>>>;
  toNode: NonNullable<Awaited<ReturnType<typeof getNode>>>;
  reactivated: string[]; // archived endpoints this edge brought back
}> => {
  if (input.from === input.to) {
    throw new Error("Cannot create an edge from a node to itself.");
  }

  const [fromNode, toNode] = await Promise.all([
    getNode(userId, input.from),
    getNode(userId, input.to),
  ]);

  if (!fromNode) {
    throw new Error(
      `Cannot create edge: node '${input.from}' does not exist. Create it first with vtx_node_create.`,
    );
  }
  if (!toNode) {
    throw new Error(
      `Cannot create edge: node '${input.to}' does not exist. Create it first with vtx_node_create.`,
    );
  }

  validateEdgePair(input.type, fromNode.type, toNode.type);

  const id = crypto.randomUUID();
  const edge: Edge = {
    id,
    from: input.from,
    to: input.to,
    type: input.type,
    evidence: input.evidence,
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };

  await Promise.all([
    redis.set(edgeKey(userId, id), edge),
    redis.sadd(allEdgesKey(userId), id),
    redis.sadd(adjFromKey(userId, input.from), id),
    redis.sadd(adjToKey(userId, input.to), id),
    redis.srem(orphansKey(userId), input.from),
    redis.srem(orphansKey(userId), input.to),
    markConnected(userId, input.from),
    markConnected(userId, input.to),
  ]);

  // A new edge means the node matters again (e.g. an auto-archived hallway contact).
  // Runs after markConnected so the two node writes don't race.
  const reactivated = [fromNode, toNode].filter((n) => n.status === "archived").map((n) => n.id);
  await Promise.all(reactivated.map((id) => reactivateNode(userId, id)));

  const [updatedFrom, updatedTo] = await Promise.all([
    getNode(userId, input.from),
    getNode(userId, input.to),
  ]);

  return { edge, fromNode: updatedFrom!, toNode: updatedTo!, reactivated };
};

export const getEdge = async (
  userId: string,
  edgeId: string,
): Promise<Edge | null> => {
  const stored = await redis.get<Edge>(edgeKey(userId, edgeId));
  return stored ?? null;
};

export const deleteEdge = async (
  userId: string,
  edgeId: string,
): Promise<boolean> => {
  const edge = await getEdge(userId, edgeId);
  if (!edge) return false;

  await Promise.all([
    redis.del(edgeKey(userId, edgeId)),
    redis.srem(allEdgesKey(userId), edgeId),
    redis.srem(archivedEdgesKey(userId), edgeId),
    redis.srem(adjFromKey(userId, edge.from), edgeId),
    redis.srem(adjToKey(userId, edge.to), edgeId),
  ]);

  // Check if either endpoint is now orphaned.
  await Promise.all([
    clearConnected(userId, edge.from),
    clearConnected(userId, edge.to),
  ]);

  return true;
};

// Hides an edge without losing it: it leaves the active indexes, so traversals, briefs,
// and orphan checks skip it, and restoreEdge can bring it back. Idempotent.
export const archiveEdge = async (userId: string, edgeId: string): Promise<Edge | null> => {
  const edge = await getEdge(userId, edgeId);
  if (!edge) return null;
  if (edge.archivedAt) return edge;

  const next: Edge = { ...edge, archivedAt: new Date().toISOString() };
  await Promise.all([
    redis.set(edgeKey(userId, edgeId), next),
    redis.sadd(archivedEdgesKey(userId), edgeId),
    redis.srem(allEdgesKey(userId), edgeId),
    redis.srem(adjFromKey(userId, edge.from), edgeId),
    redis.srem(adjToKey(userId, edge.to), edgeId),
  ]);
  await Promise.all([clearConnected(userId, edge.from), clearConnected(userId, edge.to)]);
  return next;
};

// Puts an archived edge back, like creating it again: both ends must still exist,
// and an archived endpoint is reactivated.
export const restoreEdge = async (
  userId: string,
  edgeId: string,
): Promise<{ edge: Edge; reactivated: string[] } | null> => {
  const edge = await getEdge(userId, edgeId);
  if (!edge) return null;
  if (!edge.archivedAt) return { edge, reactivated: [] };

  const [fromNode, toNode] = await Promise.all([getNode(userId, edge.from), getNode(userId, edge.to)]);
  const missing = [fromNode ? null : edge.from, toNode ? null : edge.to].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Can't restore this edge: node ${missing.map((id) => `'${id}'`).join(" and ")} no longer exists.`);
  }

  const next: Edge = { ...edge };
  delete next.archivedAt;
  await Promise.all([
    redis.set(edgeKey(userId, edgeId), next),
    redis.srem(archivedEdgesKey(userId), edgeId),
    redis.sadd(allEdgesKey(userId), edgeId),
    redis.sadd(adjFromKey(userId, edge.from), edgeId),
    redis.sadd(adjToKey(userId, edge.to), edgeId),
    redis.srem(orphansKey(userId), edge.from),
    redis.srem(orphansKey(userId), edge.to),
    markConnected(userId, edge.from),
    markConnected(userId, edge.to),
  ]);

  const reactivated = [fromNode!, toNode!].filter((n) => n.status === "archived").map((n) => n.id);
  await Promise.all(reactivated.map((id) => reactivateNode(userId, id)));
  return { edge: next, reactivated };
};

// Archived edges touching a node, newest archive first.
export const getArchivedEdges = async (userId: string, nodeId: string): Promise<Edge[]> => {
  const ids = (await redis.smembers(archivedEdgesKey(userId))) as string[];
  const edges = await Promise.all(ids.map((id) => getEdge(userId, id)));
  return edges
    .filter((e): e is Edge => e !== null && (e.from === nodeId || e.to === nodeId))
    .sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
};

// ── Adjacency queries ────────────────────────────────────────────────────────

export const getEdgesFrom = async (
  userId: string,
  nodeId: string,
): Promise<Edge[]> => {
  const ids = (await redis.smembers(adjFromKey(userId, nodeId))) as string[];
  const edges = await Promise.all(ids.map((id) => getEdge(userId, id)));
  return edges.filter((e): e is Edge => e !== null);
};

export const getEdgesTo = async (
  userId: string,
  nodeId: string,
): Promise<Edge[]> => {
  const ids = (await redis.smembers(adjToKey(userId, nodeId))) as string[];
  const edges = await Promise.all(ids.map((id) => getEdge(userId, id)));
  return edges.filter((e): e is Edge => e !== null);
};
