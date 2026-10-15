export type NodeType = "person" | "group" | "meeting" | "topic";

export type EdgeType =
  | "member_of"
  | "attended"
  | "held_by"
  | "about"
  | "involved_in"
  | "can_help_with"
  | "introduced"
  | "connects_to";

export type NodeStatus = "active" | "archived";

export const NODE_TYPES: NodeType[] = ["person", "group", "meeting", "topic"];
export const EDGE_TYPES: EdgeType[] = [
  "member_of",
  "attended",
  "held_by",
  "about",
  "involved_in",
  "can_help_with",
  "introduced",
  "connects_to",
];

// ── Pair rules (shared by the server and the edge form) ─────────────────────

// Allowed from → to node types per edge type: any listed rule may match, and within a rule
// every `from` pairs with every `to`. `null` means any pair (connects_to).
export type EdgeRule = { from: NodeType[]; to: NodeType[] };
export const EDGE_RULES: Record<EdgeType, EdgeRule[] | null> = {
  member_of: [{ from: ["person"], to: ["group"] }],
  attended: [{ from: ["person"], to: ["meeting"] }],
  held_by: [{ from: ["meeting"], to: ["group"] }],
  about: [{ from: ["meeting"], to: ["topic"] }],
  // A group can be involved in a meeting it didn't host (held_by is for the host).
  involved_in: [
    { from: ["person", "group"], to: ["topic"] },
    { from: ["group"], to: ["meeting"] },
  ],
  can_help_with: [{ from: ["person"], to: ["topic"] }],
  introduced: [{ from: ["person"], to: ["person"] }],
  connects_to: null,
};

export const edgeFits = (type: EdgeType, from: NodeType, to: NodeType): boolean => {
  const rules = EDGE_RULES[type];
  return !rules || rules.some((r) => r.from.includes(from) && r.to.includes(to));
};

// Edge types whose rule accepts this from → to pair.
export const edgeTypesFor = (from: NodeType, to: NodeType): EdgeType[] =>
  EDGE_TYPES.filter((t) => edgeFits(t, from, to));


// ── Per-type fields ──────────────────────────────────────────────────────────

export type GroupKind = "council" | "club" | "office" | "class" | "program";
export const GROUP_KINDS: GroupKind[] = ["council", "club", "office", "class", "program"];

export type PersonFields = {
  role?: string;
  affiliation?: string;
  email?: string;
  howWeMet?: string;
};

export type GroupFields = {
  kind?: GroupKind;
  url?: string;
};

// A "meeting" node covers events too (a luncheon, a talk, a reception); kind says which.
export type MeetingKind = "meeting" | "event";
export const MEETING_KINDS: MeetingKind[] = ["meeting", "event"];

export type MeetingFields = {
  date: string; // YYYY-MM-DD, local date — never converted
  kind?: MeetingKind; // unset reads as "meeting"
  ccEventId?: string;
  notes?: string; // markdown
  followUpTaskIds?: string[];
};

// ── Nodes ────────────────────────────────────────────────────────────────────

type NodeBase = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  status: NodeStatus;
  createdAt: string;
  updatedAt: string;
  connectedAt?: string;
};

export type PersonNode = NodeBase & { type: "person"; fields?: PersonFields };
export type GroupNode = NodeBase & { type: "group"; fields?: GroupFields };
export type MeetingNode = NodeBase & { type: "meeting"; fields: MeetingFields };
export type TopicNode = NodeBase & { type: "topic"; fields?: undefined };

export type VertexNode = PersonNode | GroupNode | MeetingNode | TopicNode;

// ── Edges ────────────────────────────────────────────────────────────────────

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  evidence?: string;
  notes?: string;
  createdAt: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

type CreateBase = {
  name: string;
  description?: string;
  tags?: string[];
};

export type NodeCreateInput =
  | (CreateBase & { type: "person"; fields?: PersonFields })
  | (CreateBase & { type: "group"; fields?: GroupFields })
  // Meeting name is optional — auto-generated from the date when missing.
  | (Omit<CreateBase, "name"> & { type: "meeting"; name?: string; fields: MeetingFields })
  | (CreateBase & { type: "topic" });

// Field updates merge into the existing fields; keys are validated against the node's type.
export type NodeUpdateInput = {
  name?: string;
  description?: string;
  tags?: string[];
  fields?: Record<string, unknown>;
};

export type EdgeCreateInput = {
  from: string;
  to: string;
  type: EdgeType;
  evidence?: string;
  notes?: string;
};

// ── Attachments ──────────────────────────────────────────────────────────────

// "not_transcribed": a photo or scan that needs a model to read it, on a server with no
// ANTHROPIC_API_KEY. Intentional (Coru adds the text), not an error.
export type ExtractStatus = "pending" | "done" | "failed" | "provided" | "not_transcribed";

export interface Attachment {
  id: string; // uuid
  nodeIds: string[]; // ≥1; a file can hang on several nodes
  filename: string;
  contentType: string;
  size: number;
  r2Key: string;
  caption?: string;
  extractedText?: string;
  extractStatus: ExtractStatus;
  extractError?: string;
  createdAt: string;
}
