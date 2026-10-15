import type { NodeType } from "@/lib/types";

// One fill per node type, from the theme tokens in globals.css.
export const NODE_TYPE_COLOR: Record<NodeType, string> = {
  person: "var(--node-person)",
  group: "var(--node-group)",
  meeting: "var(--node-meeting)",
  topic: "var(--node-topic)",
};

// Label text on each fill: Indigo-Void reads on all four in both themes.
export const NODE_TYPE_TEXT: Record<NodeType, string> = {
  person: "var(--node-label)",
  group: "var(--node-label)",
  meeting: "var(--node-label)",
  topic: "var(--node-label)",
};

// How each type reads in the UI. Meeting nodes cover events too (fields.kind says which).
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  person: "person",
  group: "group",
  meeting: "meeting / event",
  topic: "topic",
};
