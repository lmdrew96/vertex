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

export type MeetingFields = {
  date: string; // YYYY-MM-DD, local date — never converted
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
