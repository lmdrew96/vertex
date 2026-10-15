import { listAllAttachments } from "./attachments";
import { redis } from "./redis";
import {
  adjFromKey,
  adjToKey,
  allNodesKey,
  nodeKey,
  orphansKey,
} from "./keys";
import { GROUP_KINDS, MEETING_KINDS, type NodeCreateInput, type NodeType, type NodeUpdateInput, type VertexNode } from "./types";

// ── Slug generation ──────────────────────────────────────────────────────────

// NFD splits accented letters into letter + combining mark, so "José" / "Ștefan" / "Muñoz"
// keep their base letters instead of losing them to the ASCII filter.
export const generateSlug = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
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

// ── Fields ───────────────────────────────────────────────────────────────────

const FIELD_KEYS: Record<NodeType, string[]> = {
  person: ["role", "affiliation", "email", "howWeMet"],
  group: ["kind", "url"],
  meeting: ["date", "kind", "ccEventId", "notes", "followUpTaskIds"],
  topic: [],
};

// Calendar-valid YYYY-MM-DD. UTC here is only a validity check — the string is stored as-is.
export const isValidDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

// Validates raw fields against the node type. With `partial` (updates), keys are optional
// and `null` clears a key — except `date`, which a meeting must always have.
export const parseFields = (
  type: NodeType,
  raw: unknown,
  partial = false,
): Record<string, unknown> | undefined => {
  if (raw === undefined || raw === null) {
    if (type === "meeting" && !partial) {
      throw new Error("Meeting nodes require fields.date (YYYY-MM-DD).");
    }
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("fields must be an object.");
  }

  const allowed = FIELD_KEYS[type];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(
        allowed.length > 0
          ? `Unknown field '${key}' for a ${type} node. Allowed: ${allowed.join(", ")}.`
          : `${type} nodes have no extra fields — use description and tags instead.`,
      );
    }
    if (value === undefined) continue;
    if (value === null) {
      if (!partial || key === "date") throw new Error(`fields.${key} cannot be cleared.`);
      out[key] = null;
      continue;
    }
    if (key === "followUpTaskIds") {
      if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
        throw new Error("fields.followUpTaskIds must be an array of ControlledChaos task IDs.");
      }
    } else if (typeof value !== "string") {
      throw new Error(`fields.${key} must be a string.`);
    }
    if (key === "date" && !isValidDate(value as string)) {
      throw new Error(`fields.date must be a real date in YYYY-MM-DD form; got '${value}'.`);
    }
    if (key === "kind") {
      const kinds: string[] = type === "meeting" ? MEETING_KINDS : GROUP_KINDS;
      if (!kinds.includes(value as string)) {
        throw new Error(`fields.kind for a ${type} must be one of: ${kinds.join(", ")}.`);
      }
    }
    out[key] = value;
  }

  if (type === "meeting" && !partial && !out.date) {
    throw new Error("Meeting nodes require fields.date (YYYY-MM-DD).");
  }
  return out;
};

// "{date} · {group or first attendee}", or just the date when there's no context.
export const meetingName = (date: string, context?: string): string =>
  context ? `${date} · ${context}` : date;

// ── CRUD ─────────────────────────────────────────────────────────────────────

export const createNode = async (
  userId: string,
  input: NodeCreateInput,
): Promise<VertexNode> => {
  const fields = parseFields(input.type, "fields" in input ? input.fields : undefined);
  const name =
    input.name?.trim() ||
    (input.type === "meeting" ? meetingName(fields!.date as string) : "");
  if (!name) throw new Error("name is required.");
  if (!generateSlug(name)) throw new Error("name must contain at least one letter or number.");

  const id = await uniqueSlug(userId, name);
  const now = new Date().toISOString();
  const node = {
    id,
    type: input.type,
    name,
    description: input.description?.trim() ?? "",
    tags: input.tags ?? [],
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
  } as VertexNode;
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

  let fields = current.fields as Record<string, unknown> | undefined;
  const parsed = parseFields(current.type, patch.fields, true);
  if (parsed) {
    const merged: Record<string, unknown> = { ...(fields ?? {}) };
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    fields = Object.keys(merged).length > 0 ? merged : undefined;
  }

  const next = {
    ...current,
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    tags: patch.tags ?? current.tags,
    fields,
    updatedAt: new Date().toISOString(),
  } as VertexNode;
  if (next.fields === undefined) delete next.fields;
  await redis.set(nodeKey(userId, nodeId), next);
  return next;
};

// Brings an archived node back — used when it gets a new edge (e.g. met again).
export const reactivateNode = async (
  userId: string,
  nodeId: string,
): Promise<VertexNode | null> => {
  const current = await getNode(userId, nodeId);
  if (!current) return null;
  if (current.status === "active") return current;
  const next: VertexNode = { ...current, status: "active", updatedAt: new Date().toISOString() };
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

// Every node, active and archived.
export const listNodes = async (userId: string): Promise<VertexNode[]> => {
  const allIds = (await redis.smembers(allNodesKey(userId))) as string[];
  return (await Promise.all(allIds.map((id) => getNode(userId, id)))).filter(
    (n): n is VertexNode => n !== null,
  );
};

export type SearchOpts = {
  query: string;
  type?: NodeType;
  include_archived?: boolean;
};

export type SearchHit = {
  node: VertexNode;
  matchedIn: "name" | "description" | "notes" | "attachment";
  attachment?: { id: string; filename: string }; // set when matchedIn is "attachment"
};

const MATCH_RANK: Record<SearchHit["matchedIn"], number> = {
  name: 0,
  description: 1,
  notes: 2,
  attachment: 3,
};

// Matches name > description > meeting notes > attachment text, and reports where each node matched.
export const searchNodeHits = async (
  userId: string,
  opts: SearchOpts,
): Promise<SearchHit[]> => {
  const { query, type, include_archived = false } = opts;
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  const nodes = await listNodes(userId);
  const eligible = (n: VertexNode): boolean =>
    (include_archived || n.status !== "archived") && (!type || n.type === type);

  for (const n of nodes) {
    if (!eligible(n)) continue;
    if (n.name.toLowerCase().includes(needle)) hits.push({ node: n, matchedIn: "name" });
    else if (n.description.toLowerCase().includes(needle)) hits.push({ node: n, matchedIn: "description" });
    else if (n.type === "meeting" && n.fields.notes?.toLowerCase().includes(needle)) {
      hits.push({ node: n, matchedIn: "notes" });
    }
  }

  // Attachment text: credit each node the file hangs on that didn't already match.
  if (needle) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const matched = new Set(hits.map((h) => h.node.id));
    for (const att of await listAllAttachments(userId)) {
      if (!att.extractedText?.toLowerCase().includes(needle)) continue;
      for (const nodeId of att.nodeIds) {
        const n = byId.get(nodeId);
        if (!n || matched.has(nodeId) || !eligible(n)) continue;
        matched.add(nodeId);
        hits.push({ node: n, matchedIn: "attachment", attachment: { id: att.id, filename: att.filename } });
      }
    }
  }

  return hits.sort(
    (a, b) =>
      MATCH_RANK[a.matchedIn] - MATCH_RANK[b.matchedIn] || a.node.name.localeCompare(b.node.name),
  );
};

export const searchNodes = async (userId: string, opts: SearchOpts): Promise<VertexNode[]> =>
  (await searchNodeHits(userId, opts)).map((h) => h.node);

// ── Tags ─────────────────────────────────────────────────────────────────────

// Returns every distinct tag currently in use, for the Sidebar tag filter dropdown.
export const getAllTags = async (userId: string): Promise<string[]> => {
  const allIds = (await redis.smembers(allNodesKey(userId))) as string[];
  const nodes = (await Promise.all(allIds.map((id) => getNode(userId, id)))).filter(
    (n): n is VertexNode => n !== null,
  );
  return [...new Set(nodes.flatMap((n) => n.tags))].sort();
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
