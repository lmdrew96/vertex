import { redis } from "./redis";
import {
  adjFromKey,
  adjToKey,
  allNodesKey,
  nodeKey,
  orphansKey,
} from "./keys";
import type { NodeCreateInput, NodeStatus, NodeType, NodeUpdateInput, VertexNode } from "./types";

// ── Slug generation ──────────────────────────────────────────────────────────

export const generateSlug = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export const uniqueSlug = async (userId: string, name: string): Promise<string> => {
  const base = generateSlug(name);
  const exists = await redis.get(nodeKey(userId, base));
  if (!exists) return base;
  let n = 2;
  while (await redis.get(nodeKey(userId, `${base}-${n}`))) n++;
  return `${base}-${n}`;
};

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const createNode = async (
  userId: string,
  input: NodeCreateInput,
): Promise<VertexNode> => {
  const id = await uniqueSlug(userId, input.name);
  const now = new Date().toISOString();
  const node: VertexNode = {
    id,
    type: input.type,
    name: input.name,
    description: input.description,
    tags: input.tags ?? [],
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([
    redis.set(nodeKey(userId, id), node),
    redis.sadd(allNodesKey(userId), id),
    redis.sadd(orphansKey(userId), id),
  ]);
  return node;
};

export const getNode = async (
  userId: string,
  nodeId: string,
): Promise<VertexNode | null> => {
  const stored = await redis.get<VertexNode>(nodeKey(userId, nodeId));
  return stored ?? null;
};

// Try exact ID first; fall back to case-insensitive substring match on name.
// If multiple fuzzy matches, prefer exact-name match, then alphabetical first.
export const resolveNode = async (
  userId: string,
  idOrName: string,
): Promise<VertexNode | null> => {
  const exact = await getNode(userId, idOrName);
  if (exact) return exact;

  const allIds = (await redis.smembers(allNodesKey(userId))) as string[];
  if (allIds.length === 0) return null;

  const nodes = (
    await Promise.all(allIds.map((id) => getNode(userId, id)))
  ).filter((n): n is VertexNode => n !== null);

  const needle = idOrName.toLowerCase();
  const matches = nodes.filter((n) => n.name.toLowerCase().includes(needle));
  if (matches.length === 0) return null;

  const exactName = matches.find((n) => n.name.toLowerCase() === needle);
  if (exactName) return exactName;
  return matches.sort((a, b) => a.name.localeCompare(b.name))[0];
};

export const updateNode = async (
  userId: string,
  nodeId: string,
  patch: NodeUpdateInput,
): Promise<VertexNode | null> => {
  const current = await getNode(userId, nodeId);
  if (!current) return null;
  const next: VertexNode = {
    ...current,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    tags: patch.tags ?? current.tags,
    updatedAt: new Date().toISOString(),
  };
  await redis.set(nodeKey(userId, nodeId), next);
  return next;
};

export const archiveNode = async (
  userId: string,
  nodeId: string,
): Promise<VertexNode | null> => {
  const current = await getNode(userId, nodeId);
  if (!current) return null;
  const next: VertexNode = {
    ...current,
    status: "archived",
    updatedAt: new Date().toISOString(),
  };
  await redis.set(nodeKey(userId, nodeId), next);
  return next;
};

// ── Search ───────────────────────────────────────────────────────────────────

export type SearchOpts = {
  query: string;
  type?: NodeType;
  include_archived?: boolean;
};

export const searchNodes = async (
  userId: string,
  opts: SearchOpts,
): Promise<VertexNode[]> => {
  const { query, type, include_archived = false } = opts;
  const allIds = (await redis.smembers(allNodesKey(userId))) as string[];
  if (allIds.length === 0) return [];

  const nodes = (
    await Promise.all(allIds.map((id) => getNode(userId, id)))
  ).filter((n): n is VertexNode => n !== null);

  const needle = query.toLowerCase();

  const filtered = nodes.filter((n) => {
    if (!include_archived && n.status === "archived") return false;
    if (type && n.type !== type) return false;
    return (
      n.name.toLowerCase().includes(needle) ||
      n.description.toLowerCase().includes(needle)
    );
  });

  // Name match ranks above description-only match.
  return filtered.sort((a, b) => {
    const aNameMatch = a.name.toLowerCase().includes(needle);
    const bNameMatch = b.name.toLowerCase().includes(needle);
    if (aNameMatch && !bNameMatch) return -1;
    if (!aNameMatch && bNameMatch) return 1;
    return a.name.localeCompare(b.name);
  });
};

// ── Orphan helpers ───────────────────────────────────────────────────────────

export const getOrphanIds = async (userId: string): Promise<string[]> =>
  (await redis.smembers(orphansKey(userId))) as string[];

// Auto-archive orphan nodes older than 7 days. Returns names of archived nodes.
export const autoArchiveStaleOrphans = async (userId: string): Promise<string[]> => {
  const orphanIds = await getOrphanIds(userId);
  if (orphanIds.length === 0) return [];

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const archived: string[] = [];

  await Promise.all(
    orphanIds.map(async (id) => {
      const node = await getNode(userId, id);
      if (!node || node.status === "archived") return;
      const age = now - new Date(node.createdAt).getTime();
      if (age > sevenDaysMs) {
        await archiveNode(userId, id);
        await redis.srem(orphansKey(userId), id);
        archived.push(`Archived orphaned node: ${node.name} (created ${Math.floor(age / (24 * 60 * 60 * 1000))} days ago, never connected)`);
      }
    }),
  );

  return archived;
};

// ── Edge connection helpers (called from edges.ts) ────────────────────────────

export const markConnected = async (userId: string, nodeId: string): Promise<void> => {
  const node = await getNode(userId, nodeId);
  if (!node || node.connectedAt) return;
  const next: VertexNode = {
    ...node,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(nodeKey(userId, nodeId), next);
};

export const clearConnected = async (userId: string, nodeId: string): Promise<void> => {
  const node = await getNode(userId, nodeId);
  if (!node) return;

  // Check if this node still has any edges.
  const fromEdges = (await redis.smembers(adjFromKey(userId, nodeId))) as string[];
  const toEdges = (await redis.smembers(adjToKey(userId, nodeId))) as string[];
  if (fromEdges.length > 0 || toEdges.length > 0) return;

  const next = { ...node, updatedAt: new Date().toISOString() };
  delete next.connectedAt;
  await Promise.all([
    redis.set(nodeKey(userId, nodeId), next),
    redis.sadd(orphansKey(userId), nodeId),
  ]);
};
