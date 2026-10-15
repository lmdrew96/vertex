import { createEdge } from "./edges";
import { createNode, getNode, isValidDate, listNodes, meetingName, reactivateNode } from "./nodes";
import type { Edge, MeetingFields, MeetingKind, MeetingNode, NodeType, VertexNode } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

export type MeetingLogInput = {
  date: string;
  name?: string;
  kind?: MeetingKind; // "event" for a luncheon, talk, reception…; default meeting
  attendees?: string[]; // names or node IDs
  group?: string; // name or node ID
  topics?: string[]; // names or node IDs
  notes?: string;
  ccEventId?: string;
  followUpTaskIds?: string[];
  // Names the caller confirms are NEW nodes, even though similar ones exist.
  confirmNew?: string[];
};

type NodeRef = { id: string; name: string; type: NodeType };

export type MeetingChoice = {
  field: "attendees" | "group" | "topics";
  input: string;
  reason: "ambiguous" | "similar" | "archived";
  candidates: Array<NodeRef & { status: string; role?: string; affiliation?: string }>;
};

export type MeetingLogResult =
  | {
      status: "needs_choice";
      choices: MeetingChoice[];
      hint: string;
    }
  | {
      status: "logged";
      meeting: MeetingNode;
      created: NodeRef[];
      matched: NodeRef[];
      reactivated: NodeRef[];
      edges: Array<Pick<Edge, "id" | "type" | "from" | "to">>;
    };

// ── Name matching ────────────────────────────────────────────────────────────

const words = (name: string): string[] =>
  name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// "Trembanis" ~ "Art Trembanis": shares a word, or one name contains the other.
const isSimilarName = (a: string, b: string): boolean => {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la.includes(lb) || lb.includes(la)) return true;
  const wb = new Set(words(b));
  return words(a).some((w) => wb.has(w));
};

type Resolution =
  | { kind: "existing"; node: VertexNode }
  | { kind: "new"; name: string }
  | { kind: "choice"; choice: Omit<MeetingChoice, "field"> };

const toCandidate = (n: VertexNode): MeetingChoice["candidates"][number] => ({
  id: n.id,
  name: n.name,
  type: n.type,
  status: n.status,
  ...(n.type === "person" && n.fields?.role ? { role: n.fields.role } : {}),
  ...(n.type === "person" && n.fields?.affiliation ? { affiliation: n.fields.affiliation } : {}),
});

// Resolves one name-or-ID against nodes of the expected type. Never guesses:
// an explicit ID wins; one exact active name match wins; anything fuzzier is a choice.
const resolveRef = async (
  userId: string,
  input: string,
  type: NodeType,
  pool: VertexNode[],
  confirmNew: Set<string>,
): Promise<Resolution> => {
  const ref = input.trim();
  const byId = await getNode(userId, ref);
  if (byId) {
    if (byId.type !== type) {
      throw new Error(`'${ref}' is a ${byId.type} node, but this slot needs a ${type}.`);
    }
    return { kind: "existing", node: byId };
  }

  const needle = ref.toLowerCase();
  const sameType = pool.filter((n) => n.type === type);
  const exactActive = sameType.filter((n) => n.status === "active" && n.name.toLowerCase() === needle);

  if (exactActive.length === 1) return { kind: "existing", node: exactActive[0] };
  if (exactActive.length > 1) {
    return {
      kind: "choice",
      choice: { input: ref, reason: "ambiguous", candidates: exactActive.map(toCandidate) },
    };
  }
  if (confirmNew.has(needle)) return { kind: "new", name: ref };

  const archivedExact = sameType.filter(
    (n) => n.status === "archived" && n.name.toLowerCase() === needle,
  );
  if (archivedExact.length > 0) {
    return {
      kind: "choice",
      choice: { input: ref, reason: "archived", candidates: archivedExact.map(toCandidate) },
    };
  }

  if (type === "person") {
    const similar = sameType.filter((n) => isSimilarName(n.name, ref));
    if (similar.length > 0) {
      return {
        kind: "choice",
        choice: { input: ref, reason: "similar", candidates: similar.map(toCandidate) },
      };
    }
  }

  return { kind: "new", name: ref };
};

// ── Log ──────────────────────────────────────────────────────────────────────

export const logMeeting = async (
  userId: string,
  input: MeetingLogInput,
): Promise<MeetingLogResult> => {
  if (!isValidDate(input.date)) {
    throw new Error(`date must be a real date in YYYY-MM-DD form; got '${input.date}'.`);
  }
  const attendees = (input.attendees ?? []).map((a) => a.trim()).filter(Boolean);
  const topics = (input.topics ?? []).map((t) => t.trim()).filter(Boolean);
  const group = input.group?.trim() || undefined;
  if (attendees.length === 0 && !group) {
    throw new Error(
      "A meeting needs at least one attendee or a group. Without one it has no edges and auto-archives in 7 days, notes and all.",
    );
  }

  const pool = await listNodes(userId);
  const confirmNew = new Set((input.confirmNew ?? []).map((n) => n.trim().toLowerCase()));

  // Resolve everything before writing anything, so a choice creates nothing.
  const slots: Array<{ field: MeetingChoice["field"]; type: NodeType; input: string }> = [
    ...attendees.map((a) => ({ field: "attendees" as const, type: "person" as const, input: a })),
    ...(group ? [{ field: "group" as const, type: "group" as const, input: group }] : []),
    ...topics.map((t) => ({ field: "topics" as const, type: "topic" as const, input: t })),
  ];
  const resolutions = await Promise.all(
    slots.map((s) => resolveRef(userId, s.input, s.type, pool, confirmNew)),
  );

  const choices: MeetingChoice[] = [];
  resolutions.forEach((r, i) => {
    if (r.kind === "choice") choices.push({ field: slots[i].field, ...r.choice });
  });
  if (choices.length > 0) {
    return {
      status: "needs_choice",
      choices,
      hint: "Nothing was created. Re-call with the chosen node ID in place of the name, or add the name to confirm_new to create a new node.",
    };
  }

  // Materialize nodes. The same new name twice in one slot type becomes one node.
  const created: NodeRef[] = [];
  const matched: NodeRef[] = [];
  const reactivated: NodeRef[] = [];
  const newByKey = new Map<string, VertexNode>();
  const resolved: VertexNode[] = [];

  for (const [i, r] of resolutions.entries()) {
    const type = slots[i].type;
    if (r.kind === "existing") {
      let node = r.node;
      const seen = [...matched, ...reactivated].some((m) => m.id === node.id);
      if (node.status === "archived") {
        node = (await reactivateNode(userId, node.id)) ?? node;
        reactivated.push({ id: node.id, name: node.name, type });
      } else if (!seen) {
        matched.push({ id: node.id, name: node.name, type });
      }
      resolved.push(node);
    } else if (r.kind === "new") {
      const key = `${type}:${r.name.toLowerCase()}`;
      let node = newByKey.get(key);
      if (!node) {
        node = await createNode(userId, { type: type as "person" | "group" | "topic", name: r.name });
        newByKey.set(key, node);
        created.push({ id: node.id, name: node.name, type });
      }
      resolved.push(node);
    }
  }

  const people = dedupe(resolved.filter((_, i) => slots[i].field === "attendees"));
  const groupNode = resolved.find((_, i) => slots[i].field === "group");
  const topicNodes = dedupe(resolved.filter((_, i) => slots[i].field === "topics"));

  const fields: MeetingFields = {
    date: input.date,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.ccEventId?.trim() ? { ccEventId: input.ccEventId.trim() } : {}),
    ...(input.followUpTaskIds?.length ? { followUpTaskIds: input.followUpTaskIds } : {}),
  };
  const name =
    input.name?.trim() || meetingName(input.date, groupNode?.name ?? people[0]?.name);
  const meeting = (await createNode(userId, { type: "meeting", name, fields })) as MeetingNode;

  const edgeInputs = [
    ...people.map((p) => ({ from: p.id, to: meeting.id, type: "attended" as const })),
    ...(groupNode ? [{ from: meeting.id, to: groupNode.id, type: "held_by" as const }] : []),
    ...topicNodes.map((t) => ({ from: meeting.id, to: t.id, type: "about" as const })),
  ];
  const edges: Array<Pick<Edge, "id" | "type" | "from" | "to">> = [];
  for (const e of edgeInputs) {
    const { edge } = await createEdge(userId, e);
    edges.push({ id: edge.id, type: edge.type, from: edge.from, to: edge.to });
  }

  const finalMeeting = ((await getNode(userId, meeting.id)) ?? meeting) as MeetingNode;
  return { status: "logged", meeting: finalMeeting, created, matched, reactivated, edges };
};

const dedupe = (nodes: VertexNode[]): VertexNode[] => [
  ...new Map(nodes.map((n) => [n.id, n])).values(),
];
