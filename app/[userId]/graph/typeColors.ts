import type { NodeType } from "@/lib/types";

// One color per node type, from the theme tokens in globals.css.
export const NODE_TYPE_COLOR: Record<NodeType, string> = {
  person: "var(--color-gold)",
  group: "var(--color-teal-deep)",
  meeting: "var(--color-mint)",
  topic: "var(--color-purple)",
};

// Readable text on each fill: ink on the light fills, white on the dark ones.
export const NODE_TYPE_TEXT: Record<NodeType, string> = {
  person: "var(--color-ink)",
  group: "var(--color-white)",
  meeting: "var(--color-ink)",
  topic: "var(--color-white)",
};
