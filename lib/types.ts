export type NodeType = "concept" | "person" | "work" | "claim" | "question";

export type EdgeType =
  | "connects_to"
  | "tension_with"
  | "instance_of"
  | "contradicts"
  | "evidenced_by";

export type NodeStatus = "active" | "archived";

export const NODE_TYPES: NodeType[] = ["concept", "person", "work", "claim", "question"];
export const EDGE_TYPES: EdgeType[] = [
  "connects_to",
  "tension_with",
  "instance_of",
  "contradicts",
  "evidenced_by",
];

export interface VertexNode {
  id: string;
  type: NodeType;
  name: string;
  description: string;
  tags: string[];
  status: NodeStatus;
  createdAt: string;
  updatedAt: string;
  connectedAt?: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  evidence?: string;
  notes?: string;
  createdAt: string;
}

export type NodeCreateInput = {
  type: NodeType;
  name: string;
  description: string;
  tags?: string[];
};

export type NodeUpdateInput = {
  name?: string;
  description?: string;
  tags?: string[];
};

export type EdgeCreateInput = {
  from: string;
  to: string;
  type: EdgeType;
  evidence?: string;
  notes?: string;
};
