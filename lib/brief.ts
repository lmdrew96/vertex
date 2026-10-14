import { getEdgesFrom, getEdgesTo } from "./edges";
import { listNodes } from "./nodes";
import type { Edge, MeetingNode, VertexNode } from "./types";

// ── Shared helpers ───────────────────────────────────────────────────────────

type Neighbor = { edge: Edge; other: VertexNode };

const MAX_LINKS = 5;
const EXCERPT_CHARS = 280;

// Active nodes on the other end of every edge touching nodeId (both directions).
const neighbors = async (
  userId: string,
  nodeId: string,
  byId: Map<string, VertexNode>,
): Promise<Neighbor[]> => {
  const [outgoing, incoming] = await Promise.all([
    getEdgesFrom(userId, nodeId),
    getEdgesTo(userId, nodeId),
  ]);
  return [...outgoing, ...incoming].flatMap((edge) => {
    const other = byId.get(edge.from === nodeId ? edge.to : edge.from);
    return other && other.status === "active" ? [{ edge, other }] : [];
  });
};

// Plain-language reading of an edge, e.g. "Art Trembanis member of PSAC".
const describeEdge = (edge: Edge, byId: Map<string, VertexNode>): string => {
  const from = byId.get(edge.from)?.name ?? edge.from;
  const to = byId.get(edge.to)?.name ?? edge.to;
  const base =
    edge.type === "introduced"
      ? `${from} introduced Nae to ${to}`
      : `${from} ${edge.type.replace(/_/g, " ")} ${to}`;
  return edge.notes ? `${base} (${edge.notes})` : base;
};

const byDateDesc = (a: MeetingNode, b: MeetingNode): number =>
  b.fields.date.localeCompare(a.fields.date) || a.name.localeCompare(b.name);

const excerpt = (text: string | undefined): string | undefined => {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS)}…` : flat;
};

// Collects one entry per node with every reason it's connected.
class LinkMap {
  private entries = new Map<string, { node: VertexNode; links: string[] }>();

  add(node: VertexNode, link: string): void {
    const entry = this.entries.get(node.id) ?? { node, links: [] };
    if (!entry.links.includes(link)) entry.links.push(link);
    this.entries.set(node.id, entry);
  }

  // Most-connected first; long link lists are capped with a count.
  list(): Array<{ node: VertexNode; links: string[] }> {
    return [...this.entries.values()]
      .sort((a, b) => b.links.length - a.links.length || a.node.name.localeCompare(b.node.name))
      .map(({ node, links }) => ({
        node,
        links:
          links.length > MAX_LINKS
            ? [...links.slice(0, MAX_LINKS), `…and ${links.length - MAX_LINKS} more`]
            : links,
      }));
  }
}

// ── vtx_brief ────────────────────────────────────────────────────────────────

export type BriefResult =
  | {
      status: "needs_choice";
      input: string;
      candidates: Array<{ id: string; name: string; type: string }>;
    }
  | {
      status: "ok";
      node: VertexNode;
      lastContact: string | null;
      recentMeetings: Array<{ id: string; name: string; date: string; notesExcerpt?: string }>;
      people: Array<{ id: string; name: string; role?: string; affiliation?: string; links: string[] }>;
      groups: Array<{ id: string; name: string; kind?: string; links: string[] }>;
      topics: Array<{ id: string; name: string; links: string[] }>;
      openFollowUps: Array<{ taskId: string; meeting: string; date: string }>;
    };

// ID → one exact name → one substring match. More than one match is a choice, never a guess.
const resolveForBrief = (
  ref: string,
  all: VertexNode[],
  byId: Map<string, VertexNode>,
): VertexNode | VertexNode[] | null => {
  const direct = byId.get(ref.trim());
  if (direct) return direct;
  const needle = ref.trim().toLowerCase();
  const active = all.filter((n) => n.status === "active");
  const exact = active.filter((n) => n.name.toLowerCase() === needle);
  if (exact.length > 0) return exact.length === 1 ? exact[0] : exact;
  const partial = active.filter((n) => n.name.toLowerCase().includes(needle));
  if (partial.length === 0) return null;
  return partial.length === 1 ? partial[0] : partial;
};

export const brief = async (
  userId: string,
  ref: string,
  limitMeetings = 5,
): Promise<BriefResult | null> => {
  const all = await listNodes(userId);
  const byId = new Map(all.map((n) => [n.id, n]));
  const resolved = resolveForBrief(ref, all, byId);
  if (!resolved) return null;
  if (Array.isArray(resolved)) {
    return {
      status: "needs_choice",
      input: ref,
      candidates: resolved.map((n) => ({ id: n.id, name: n.name, type: n.type })),
    };
  }

  const root = resolved;
  const direct = await neighbors(userId, root.id, byId);

  const meetings =
    root.type === "meeting"
      ? [root]
      : [
          ...new Map(
            direct
              .filter((d): d is { edge: Edge; other: MeetingNode } => d.other.type === "meeting")
              .map((d) => [d.other.id, d.other]),
          ).values(),
        ].sort(byDateDesc);
  const recent = meetings.slice(0, limitMeetings);

  const people = new LinkMap();
  const groups = new LinkMap();
  const topics = new LinkMap();
  const bucket = (n: VertexNode): LinkMap | null =>
    n.type === "person" ? people : n.type === "group" ? groups : n.type === "topic" ? topics : null;

  for (const { edge, other } of direct) {
    bucket(other)?.add(other, describeEdge(edge, byId));
  }

  // Second hop through every linked meeting (not just the recent ones).
  if (root.type !== "meeting") {
    const meetingNeighbors = await Promise.all(meetings.map((m) => neighbors(userId, m.id, byId)));
    meetings.forEach((m, i) => {
      for (const { other } of meetingNeighbors[i]) {
        if (other.id === root.id) continue;
        const via =
          other.type === "person"
            ? `at ${m.name}`
            : other.type === "group"
              ? `held ${m.name}`
              : `discussed at ${m.name}`;
        bucket(other)?.add(other, via);
      }
    });
  }

  return {
    status: "ok",
    node: root,
    lastContact: meetings[0]?.fields.date ?? null,
    recentMeetings: recent.map((m) => ({
      id: m.id,
      name: m.name,
      date: m.fields.date,
      ...(m.fields.notes ? { notesExcerpt: excerpt(m.fields.notes) } : {}),
    })),
    people: people.list().map(({ node, links }) => ({
      id: node.id,
      name: node.name,
      ...(node.type === "person" && node.fields?.role ? { role: node.fields.role } : {}),
      ...(node.type === "person" && node.fields?.affiliation
        ? { affiliation: node.fields.affiliation }
        : {}),
      links,
    })),
    groups: groups.list().map(({ node, links }) => ({
      id: node.id,
      name: node.name,
      ...(node.type === "group" && node.fields?.kind ? { kind: node.fields.kind } : {}),
      links,
    })),
    topics: topics.list().map(({ node, links }) => ({ id: node.id, name: node.name, links })),
    openFollowUps: recent.flatMap((m) =>
      (m.fields.followUpTaskIds ?? []).map((taskId) => ({ taskId, meeting: m.name, date: m.fields.date })),
    ),
  };
};

// ── vtx_who_knows ────────────────────────────────────────────────────────────

const STRENGTH = { can_help_with: 3, involved_in: 2, mentioned: 1 } as const;
type Strength = keyof typeof STRENGTH;

export type WhoKnowsResult = {
  query: string;
  matchedTopics: Array<{ id: string; name: string }>;
  people: Array<{
    id: string;
    name: string;
    role?: string;
    affiliation?: string;
    strength: Strength;
    why: string[];
  }>;
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whole-word containment, so topic "AI" doesn't match the query "said".
const containsPhrase = (haystack: string, phrase: string): boolean =>
  new RegExp(`\\b${escapeRegex(phrase)}\\b`, "i").test(haystack);

export const whoKnows = async (userId: string, query: string): Promise<WhoKnowsResult> => {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new Error("query is required.");

  const all = await listNodes(userId);
  const byId = new Map(all.map((n) => [n.id, n]));
  const active = all.filter((n) => n.status === "active");

  const found = new Map<string, { node: VertexNode; score: number; strength: Strength; why: string[] }>();
  const credit = (node: VertexNode | undefined, strength: Strength, why: string): void => {
    if (!node || node.type !== "person" || node.status !== "active") return;
    const entry = found.get(node.id) ?? { node, score: 0, strength, why: [] };
    if (STRENGTH[strength] > entry.score) {
      entry.score = STRENGTH[strength];
      entry.strength = strength;
    }
    if (!entry.why.includes(why)) entry.why.push(why);
    found.set(node.id, entry);
  };

  // 1. Topics the query names (either direction), and who's tied to them.
  const matchedTopics = active.filter(
    (n) =>
      n.type === "topic" &&
      (n.name.toLowerCase().includes(needle) ||
        containsPhrase(needle, n.name) ||
        n.description.toLowerCase().includes(needle)),
  );
  for (const topic of matchedTopics) {
    for (const edge of await getEdgesTo(userId, topic.id)) {
      const from = byId.get(edge.from);
      if (edge.type === "can_help_with" || edge.type === "involved_in") {
        credit(from, edge.type, `${edge.type.replace(/_/g, " ")} ${topic.name}`);
      } else if (edge.type === "about" && from?.type === "meeting") {
        for (const a of await getEdgesTo(userId, from.id)) {
          if (a.type === "attended") credit(byId.get(a.from), "mentioned", `at ${from.name} (about ${topic.name})`);
        }
      }
    }
  }

  // 2. Meetings whose notes mention it → everyone who attended.
  for (const m of active) {
    if (m.type !== "meeting" || !m.fields.notes?.toLowerCase().includes(needle)) continue;
    for (const a of await getEdgesTo(userId, m.id)) {
      if (a.type === "attended") credit(byId.get(a.from), "mentioned", `mentioned in notes of ${m.name}`);
    }
  }

  // 3. The person's own profile mentions it (description, role, affiliation, how we met).
  for (const p of active) {
    if (p.type !== "person") continue;
    const profile = [p.description, p.fields?.role, p.fields?.affiliation, p.fields?.howWeMet]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (profile.includes(needle)) credit(p, "mentioned", "their profile mentions it");
  }

  const people = [...found.values()]
    .sort(
      (a, b) => b.score - a.score || b.why.length - a.why.length || a.node.name.localeCompare(b.node.name),
    )
    .map(({ node, strength, why }) => ({
      id: node.id,
      name: node.name,
      ...(node.type === "person" && node.fields?.role ? { role: node.fields.role } : {}),
      ...(node.type === "person" && node.fields?.affiliation ? { affiliation: node.fields.affiliation } : {}),
      strength,
      why,
    }));

  return {
    query: query.trim(),
    matchedTopics: matchedTopics.map((t) => ({ id: t.id, name: t.name })),
    people,
  };
};
