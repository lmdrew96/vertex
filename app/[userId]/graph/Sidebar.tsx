"use client";

import { useEffect, useState } from "react";
import { NODE_TYPES, type NodeType, type VertexNode } from "@/lib/types";
import { searchNodesAction } from "./actions";
import { NODE_TYPE_COLOR, NODE_TYPE_LABEL, NODE_TYPE_TEXT } from "./typeColors";
import { AppNav } from "../../AppNav";


const s = {
  sidebar: {
    width: 300,
    flexShrink: 0,
    borderRight: "1.5px solid var(--hairline)",
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    position: "sticky" as const,
    top: 0,
    overflowY: "auto" as const,
  },
  section: { padding: "16px 18px", borderBottom: "1.5px solid var(--hairline)" },
  h1: { fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, margin: "0 0 14px 0" },
  chipRow: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 8 },
  // Type filters: square chips filled with the type color when on.
  typeChip: (active: boolean, color: string, text: string) => ({
    ...(active ? { background: color, borderColor: color, color: text } : {}),
  }),
  dot: (color: string) => ({ width: 9, height: 9, background: color, display: "inline-block", flexShrink: 0 }),
  orphanRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 10px",
    borderRadius: "var(--radius-btn)",
    background: "var(--inset)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 6,
  },
  list: { flexShrink: 0 },
  // Selected: a solid foreground bar on the left plus the inset tint.
  listItem: (active: boolean) => ({
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    padding: "10px 18px",
    borderBottom: "1px solid var(--hairline)",
    background: active ? "var(--inset)" : "transparent",
    boxShadow: active ? "inset 4px 0 0 var(--foreground)" : "none",
    cursor: "pointer",
  }),
  itemName: { fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500 },
  empty: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted-foreground)", padding: 18, margin: 0 },
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
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
    <div className="panel" style={{ ...s.sidebar, width: isMobile ? "100%" : s.sidebar.width, height: isMobile ? "auto" : s.sidebar.height, position: isMobile ? "static" : s.sidebar.position }}>
      <div style={s.section}>
        <h1 style={{ ...s.h1, margin: "0 0 8px 0" }}>Vertex</h1>
        <div style={{ margin: "0 0 14px" }}>
          <AppNav token={userId} current="graph" />
        </div>
        <input
          className="input"
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ ...s.chipRow, marginTop: 10 }} role="group" aria-label="Filter by type">
          <button
            type="button"
            className="chip"
            aria-pressed={type === ""}
            onClick={() => setType("")}
          >
            All
          </button>
          {NODE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              style={s.typeChip(type === t, NODE_TYPE_COLOR[t], NODE_TYPE_TEXT[t])}
              aria-pressed={type === t}
              onClick={() => setType(type === t ? "" : t)}
            >
              {type !== t && <span style={s.dot(NODE_TYPE_COLOR[t])} />}
              {NODE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {allTags.length > 0 && (
        <div style={s.section}>
          <p className="label">Tags</p>
          <div style={s.chipRow}>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                style={{ textTransform: "none" }}
                aria-pressed={selectedTags.includes(tag)}
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
            className="label"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, margin: 0 }}
            aria-expanded={orphansOpen}
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
                    <span className="meta" style={{ flexShrink: 0 }}>{days}d unconnected</span>
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
              <span className="meta" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={s.dot(NODE_TYPE_COLOR[n.type])} />
                {n.type === "meeting" ? n.fields.date : n.type}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
