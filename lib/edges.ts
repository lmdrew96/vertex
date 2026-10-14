import { redis } from "./redis";
import {
  adjFromKey,
  adjToKey,
  allEdgesKey,
  edgeKey,
  orphansKey,
} from "./keys";
import { clearConnected, getNode, markConnected } from "./nodes";
import { EDGE_TYPES, type Edge, type EdgeCreateInput, type EdgeType, type NodeType } from "./types";

// ── Pair rules ───────────────────────────────────────────────────────────────

// Allowed from → to node types per edge type. `null` means any pair (connects_to).
export const EDGE_RULES: Record<EdgeType, { from: NodeType[]; to: NodeType[] } | null> = {
  member_of: { from: ["person"], to: ["group"] },
  attended: { from: ["person"], to: ["meeting"] },
  held_by: { from: ["meeting"], to: ["group"] },
  about: { from: ["meeting"], to: ["topic"] },
  involved_in: { from: ["person", "group"], to: ["topic"] },
  can_help_with: { from: ["person"], to: ["topic"] },
  introduced: { from: ["person"], to: ["person"] },
  connects_to: null,
};

const describeRule = (type: EdgeType): string => {
  const rule = EDGE_RULES[type];
  return rule ? `${rule.from.join("/")} → ${rule.to.join("/")}` : "any → any";
};

// Edge types whose rule accepts this from → to pair.
export const edgeTypesFor = (from: NodeType, to: NodeType): EdgeType[] =>
  EDGE_TYPES.filter((t) => {
    const rule = EDGE_RULES[t];
    return !rule || (rule.from.includes(from) && rule.to.includes(to));
  });

// Throws with the allowed pair and the edge types that would fit, so the caller can retry.
export const validateEdgePair = (type: EdgeType, from: NodeType, to: NodeType): void => {
  const rule = EDGE_RULES[type];
  if (!rule || (rule.from.includes(from) && rule.to.includes(to))) return;
  throw new Error(
    `${type} must go ${describeRule(type)}; got ${from} → ${to}. ` +
      `Edge types that fit ${from} → ${to}: ${edgeTypesFor(from, to).join(", ")}.`,
  );
};

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const createEdge = async (
  userId: string,
  input: EdgeCreateInput,
): Promise<{ edge: Edge; fromNode: NonNullable<Awaited<ReturnType<typeof getNode>>>; toNode: NonNullable<Awaited<ReturnType<typeof getNode>>> }> => {
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

  const [updatedFrom, updatedTo] = await Promise.all([
    getNode(userId, input.from),
    getNode(userId, input.to),
  ]);

  return { edge, fromNode: updatedFrom!, toNode: updatedTo! };
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
