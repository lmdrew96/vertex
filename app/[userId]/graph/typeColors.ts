import type { NodeType } from "@/lib/types";

// One color per node type, from the theme tokens in globals.css.
export const NODE_TYPE_COLOR: Record<NodeType, string> = {
  person: "var(--color-gold)",
  group: "var(--color-teal-deep)",
  meeting: "var(--color-mint)",
  topic: "var(--color-purple)",
};

// Readable text on each fill in both themes (the dark theme lightens teal-deep, so its text flips).
export const NODE_TYPE_TEXT: Record<NodeType, string> = {
  person: "var(--color-on-light)",
  group: "var(--color-on-dark)",
  meeting: "var(--color-on-light)",
  topic: "var(--color-on-dark)",
};

// How each type reads in the UI. Meeting nodes cover events too (fields.kind says which).
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  person: "person",
  group: "group",
  meeting: "meeting / event",
  topic: "topic",
};
