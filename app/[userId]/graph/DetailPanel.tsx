"use client";

import { useEffect, useState } from "react";
import type { Edge, VertexNode } from "@/lib/types";
import { archiveNodeAction, getNodeWithEdgesAction } from "./actions";

type NodeWithEdges = {
  node: VertexNode;
  edges: {
    outgoing: Array<{ edge: Edge; target: VertexNode }>;
    incoming: Array<{ edge: Edge; source: VertexNode }>;
  };
};

const s = {
  panel: (open: boolean, mobile: boolean) =>
    mobile
      ? {
          position: "fixed" as const,
          top: 0,
          right: 0,
          height: "100vh",
          width: "100%",
          background: "var(--color-white)",
          boxShadow: "-4px 0px 16px rgba(0,0,0,0.08)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          overflowY: "auto" as const,
          zIndex: 30,
          display: "flex",
          flexDirection: "column" as const,
        }
      : {
          position: "relative" as const,
          height: "100vh",
          // Width change is instant (no transition) so the canvas reflows
          // immediately — only the inner content slides, via innerWrap below.
          width: open ? 380 : 0,
          flexShrink: 0,
          background: "var(--color-white)",
          borderLeft: open ? "1.5px solid var(--color-lavender)" : "none",
          boxShadow: open ? "-4px 0px 16px rgba(0,0,0,0.08)" : "none",
          overflowX: "hidden" as const,
          overflowY: "auto" as const,
          display: "flex",
          flexDirection: "column" as const,
        },
  innerWrap: (open: boolean, mobile: boolean) => ({
    width: mobile ? "100%" : 380,
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    transform: mobile ? undefined : open ? "translateX(0)" : "translateX(100%)",
    transition: mobile ? undefined : "transform 0.2s ease",
  }),
  header: {
    padding: "20px 22px 14px",
    borderBottom: "1.5px solid var(--color-lavender)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: "var(--color-teal-deep)",
    cursor: "pointer",
    lineHeight: 1,
  },
  name: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 600,
    color: "var(--color-ink)",
    margin: "0 0 6px 0",
  },
  badge: (color: string) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--color-white)",
    background: color,
    borderRadius: 9999,
    padding: "3px 10px",
    display: "inline-block",
  }),
  body: { padding: "18px 22px", flex: 1 },
  description: {
    fontFamily: "var(--font-body)",
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--color-ink)",
    margin: "0 0 18px 0",
  },
  chipRow: { display: "flex", flexWrap: "wrap" as const, gap: 6, marginBottom: 20 },
  chip: (origin: boolean) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "3px 9px",
    borderRadius: 9999,
    background: origin ? "var(--color-gold)" : "var(--color-surface)",
    color: origin ? "var(--color-ink)" : "var(--color-teal-deep)",
    border: origin ? "none" : "1px solid var(--color-lavender)",
    fontWeight: origin ? 600 : 400,
  }),
  sectionLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-teal-deep)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    opacity: 0.7,
    margin: "0 0 8px 0",
  },
  edgeRow: {
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--color-surface)",
    marginBottom: 6,
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    fontSize: 13,
  },
  edgeType: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--color-teal-deep)",
    opacity: 0.7,
  },
  edgeNote: {
    fontFamily: "var(--font-body)",
    fontSize: 12,
    color: "var(--color-ink)",
    opacity: 0.7,
    margin: "3px 0 0 0",
  },
  footer: { padding: "16px 22px", borderTop: "1.5px solid var(--color-lavender)" },
  archiveBtn: {
    fontFamily: "var(--font-body)",
    background: "none",
    border: "1.5px solid #c0392b",
    color: "#c0392b",
    borderRadius: 9999,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    width: "100%",
  },
};

const NODE_TYPE_COLOR: Record<string, string> = {
  concept: "var(--color-teal-deep)",
  person: "var(--color-gold)",
  work: "var(--color-mint)",
  claim: "var(--color-olive)",
  question: "var(--color-purple)",
};

const truncate = (text: string, max = 90) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

type DetailPanelProps = {
  userId: string;
  nodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onArchived: (nodeId: string) => void;
  onClose: () => void;
  isMobile: boolean;
};

export function DetailPanel({
  userId,
  nodeId,
  onSelectNode,
  onArchived,
  onClose,
  isMobile,
}: DetailPanelProps) {
  const [data, setData] = useState<NodeWithEdges | null>(null);

  useEffect(() => {
    if (!nodeId) {
      setData(null);
      return;
    }
    getNodeWithEdgesAction(userId, nodeId).then(setData);
  }, [userId, nodeId]);

  const handleArchive = async () => {
    if (!data) return;
    if (!window.confirm(`Archive "${data.node.name}"? This can't be undone from the UI.`)) return;
    await archiveNodeAction(userId, data.node.id);
    onArchived(data.node.id);
  };

  // Driven by nodeId (not data) so the layout reserves space in the same
  // render as GraphCanvas kicks off its fetch — avoids a race where the
  // canvas fits its view against a container that's about to shrink.
  const open = Boolean(nodeId);

  return (
    <div style={s.panel(open, isMobile)}>
      {data && (
        <div style={s.innerWrap(open, isMobile)}>
          <div style={s.header}>
            <div>
              <p style={s.name}>{data.node.name}</p>
              <span style={s.badge(NODE_TYPE_COLOR[data.node.type])}>{data.node.type}</span>
            </div>
            <button style={s.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div style={s.body}>
            <p style={s.description}>{data.node.description}</p>

            {data.node.tags.length > 0 && (
              <div style={s.chipRow}>
                {data.node.tags.map((tag) => (
                  <span key={tag} style={s.chip(tag.startsWith("origin:"))}>
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <p style={s.sectionLabel}>Connects to ({data.edges.outgoing.length})</p>
            <div style={{ marginBottom: 20 }}>
              {data.edges.outgoing.length === 0 && (
                <p style={s.edgeNote}>Nothing yet.</p>
              )}
              {data.edges.outgoing.map(({ edge, target }) => (
                <div key={edge.id} style={s.edgeRow} onClick={() => onSelectNode(target.id)}>
                  <div>
                    <strong>{target.name}</strong>{" "}
                    <span style={s.edgeType}>{edge.type}</span>
                  </div>
                  {(edge.evidence || edge.notes) && (
                    <p style={s.edgeNote}>{truncate(edge.evidence ?? edge.notes ?? "")}</p>
                  )}
                </div>
              ))}
            </div>

            <p style={s.sectionLabel}>Connected from ({data.edges.incoming.length})</p>
            <div>
              {data.edges.incoming.length === 0 && (
                <p style={s.edgeNote}>Nothing yet.</p>
              )}
              {data.edges.incoming.map(({ edge, source }) => (
                <div key={edge.id} style={s.edgeRow} onClick={() => onSelectNode(source.id)}>
                  <div>
                    <strong>{source.name}</strong>{" "}
                    <span style={s.edgeType}>{edge.type}</span>
                  </div>
                  {(edge.evidence || edge.notes) && (
                    <p style={s.edgeNote}>{truncate(edge.evidence ?? edge.notes ?? "")}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div style={s.footer}>
            <button style={s.archiveBtn} onClick={handleArchive}>
              Archive node
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
