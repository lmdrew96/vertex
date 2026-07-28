"use client";

import { useEffect, useState } from "react";
import { NODE_TYPES, type NodeType, type VertexNode } from "@/lib/types";
import { searchNodesAction } from "./actions";

const DEFAULT_DOMAIN_TAG = "domain:sla";

const s = {
  sidebar: {
    width: 300,
    flexShrink: 0,
    borderRight: "1.5px solid var(--color-lavender)",
    background: "var(--color-white)",
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    position: "sticky" as const,
    top: 0,
    overflowY: "auto" as const,
  },
  section: {
    padding: "16px 18px",
    borderBottom: "1.5px solid var(--color-lavender)",
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 600,
    color: "var(--color-ink)",
    margin: "0 0 14px 0",
  },
  input: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "9px 11px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  select: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 13,
    padding: "8px 10px",
    outline: "none",
    width: "100%",
    marginTop: 10,
    boxSizing: "border-box" as const,
  },
  label: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-teal-deep)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    opacity: 0.6,
    margin: "0 0 8px 0",
  },
  chipRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 6,
    marginTop: 8,
  },
  chip: (active: boolean) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12,
    fontWeight: 500,
    padding: "5px 10px",
    borderRadius: 9999,
    border: `1.5px solid ${active ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: active ? "var(--color-teal-deep)" : "transparent",
    color: active ? "var(--color-white)" : "var(--color-ink)",
    cursor: "pointer",
  }),
  orphanRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--color-surface)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 6,
  },
  orphanBadge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--color-gold)",
  },
  list: {
    flexShrink: 0,
  },
  listItem: (active: boolean) => ({
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    padding: "10px 18px",
    borderBottom: "1px solid var(--color-lavender)",
    background: active ? "var(--color-surface)" : "transparent",
    cursor: "pointer",
  }),
  itemName: {
    fontFamily: "var(--font-body)",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--color-ink)",
  },
  itemMeta: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--color-teal-deep)",
    opacity: 0.7,
  },
  empty: {
    fontFamily: "var(--font-body)",
    fontSize: 13,
    color: "var(--color-teal-deep)",
    opacity: 0.6,
    padding: "18px",
  },
};

type SidebarProps = {
  userId: string;
  initialNodes: VertexNode[];
  allTags: string[];
  orphanIds: string[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  isMobile: boolean;
};

export function Sidebar({
  userId,
  initialNodes,
  allTags,
  orphanIds,
  selectedNodeId,
  onSelectNode,
  isMobile,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<NodeType | "">("");
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    allTags.includes(DEFAULT_DOMAIN_TAG) ? [DEFAULT_DOMAIN_TAG] : [],
  );
  const [results, setResults] = useState(initialNodes);
  const [orphansOpen, setOrphansOpen] = useState(true);

  useEffect(() => {
    const handle = setTimeout(async () => {
      const res = await searchNodesAction(userId, {
        query,
        type: type || undefined,
      });
      setResults(res);
    }, 250);
    return () => clearTimeout(handle);
  }, [userId, query, type, initialNodes]);

  const toggleTag = (tag: string) => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  };

  const filtered = results.filter((n) =>
    selectedTags.every((t) => n.tags.includes(t)),
  );

  const orphanNodes = initialNodes.filter((n) => orphanIds.includes(n.id));

  return (
    <div style={{ ...s.sidebar, width: isMobile ? "100%" : s.sidebar.width, height: isMobile ? "auto" : s.sidebar.height, position: isMobile ? "static" : s.sidebar.position }}>
      <div style={s.section}>
        <h1 style={s.h1}>Vertex</h1>
        <input
          style={s.input}
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          style={s.select}
          value={type}
          onChange={(e) => setType(e.target.value as NodeType | "")}
        >
          <option value="">All types</option>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {allTags.length > 0 && (
        <div style={s.section}>
          <p style={s.label}>Tags</p>
          <div style={s.chipRow}>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                style={s.chip(selectedTags.includes(tag))}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {orphanNodes.length > 0 && (
        <div style={s.section}>
          <button
            type="button"
            onClick={() => setOrphansOpen((v) => !v)}
            style={{ ...s.label, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            {orphansOpen ? "▾" : "▸"} Orphans ({orphanNodes.length})
          </button>
          {orphansOpen && (
            <div style={{ marginTop: 10 }}>
              {orphanNodes.map((n) => {
                const days = Math.floor(
                  (Date.now() - new Date(n.createdAt).getTime()) / (24 * 60 * 60 * 1000),
                );
                return (
                  <div key={n.id} style={s.orphanRow} onClick={() => onSelectNode(n.id)}>
                    <span>{n.name}</span>
                    <span style={s.orphanBadge}>{days}d unconnected</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={s.list}>
        {filtered.length === 0 ? (
          <p style={s.empty}>No nodes match these filters.</p>
        ) : (
          filtered.map((n) => (
            <div
              key={n.id}
              style={s.listItem(n.id === selectedNodeId)}
              onClick={() => onSelectNode(n.id)}
            >
              <span style={s.itemName}>{n.name}</span>
              <span style={s.itemMeta}>{n.type}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
