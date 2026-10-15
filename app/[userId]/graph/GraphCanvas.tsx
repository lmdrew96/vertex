"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { Edge as VertexEdge, EdgeType, NodeType } from "@/lib/types";
import type { Subgraph } from "@/lib/graph";
import { graphQueryAction } from "./actions";

import { NODE_TYPE_COLOR, NODE_TYPE_TEXT } from "./typeColors";

const EDGE_TYPE_STYLE: Record<
  EdgeType,
  { stroke: string; strokeWidth: number; dashed?: boolean; arrow?: boolean }
> = {
  member_of: { stroke: "var(--color-teal-deep)", strokeWidth: 2, arrow: true },
  attended: { stroke: "var(--color-mint)", strokeWidth: 1.5 },
  held_by: { stroke: "var(--color-teal-deep)", strokeWidth: 1.5, dashed: true },
  about: { stroke: "var(--color-purple)", strokeWidth: 1.5, dashed: true },
  involved_in: { stroke: "var(--color-purple)", strokeWidth: 2 },
  can_help_with: { stroke: "var(--color-gold)", strokeWidth: 2.5, arrow: true },
  introduced: { stroke: "var(--color-gold)", strokeWidth: 2, dashed: true, arrow: true },
  connects_to: { stroke: "var(--color-lavender)", strokeWidth: 1.5 },
};

const RING_SPACING = 220;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 64;
const MEETING_WIDTH = 112;
const MEETING_HEIGHT = 52;
const NODE_LABEL_MAX_CHARS = 15;

function truncateLabel(name: string): string {
  return name.length > NODE_LABEL_MAX_CHARS
    ? `${name.slice(0, NODE_LABEL_MAX_CHARS - 1)}…`
    : name;
}

function layout(subgraph: Subgraph): RFNode[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of subgraph.edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push(edge.to);
    adjacency.get(edge.to)!.push(edge.from);
  }

  const level = new Map<string, number>([[subgraph.root.id, 0]]);
  let frontier = [subgraph.root.id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!level.has(neighbor)) {
          level.set(neighbor, level.get(id)! + 1);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  const byLevel = new Map<number, string[]>();
  for (const node of subgraph.nodes) {
    const l = level.get(node.id) ?? 0;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(node.id);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [l, ids] of byLevel) {
    if (l === 0) {
      positions.set(ids[0], { x: 0, y: 0 });
      continue;
    }
    const radius = l * RING_SPACING;
    ids.forEach((id, i) => {
      const angle = (i / ids.length) * 2 * Math.PI;
      positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });
  }

  return subgraph.nodes.map((node) => {
    const center = positions.get(node.id) ?? { x: 0, y: 0 };
    // Meetings are events, not entities, so they draw smaller.
    const small = node.type === "meeting";
    const width = small ? MEETING_WIDTH : NODE_WIDTH;
    const height = small ? MEETING_HEIGHT : NODE_HEIGHT;
    return {
      id: node.id,
      position: { x: center.x - width / 2, y: center.y - height / 2 },
      width,
      height,
      data: { label: `${truncateLabel(node.name)}\n(${node.type})` },
      style: {
        background: NODE_TYPE_COLOR[node.type],
        color: NODE_TYPE_TEXT[node.type],
        border: node.id === subgraph.root.id ? "3px solid var(--color-ink)" : "none",
        borderRadius: 10,
        fontFamily: "var(--font-body)",
        fontSize: small ? 11 : 12,
        fontWeight: 500,
        whiteSpace: "pre-line",
        textAlign: "center",
        padding: small ? 6 : 8,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      },
    };
  });
}

function computeBounds(nodes: RFNode[]): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? NODE_WIDTH)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.height ?? NODE_HEIGHT)));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildEdges(subgraph: Subgraph): RFEdge[] {
  return subgraph.edges.map((edge) => {
    const style = EDGE_TYPE_STYLE[edge.type];
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      label: edge.type,
      style: {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDasharray: style.dashed ? "6 4" : undefined,
      },
      markerEnd: style.arrow ? { type: MarkerType.ArrowClosed, color: style.stroke } : undefined,
      labelStyle: { fontFamily: "var(--font-mono)", fontSize: 10 },
    };
  });
}

const s = {
  container: {
    flex: 1,
    position: "relative" as const,
    minHeight: 400,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    fontFamily: "var(--font-body)",
    color: "var(--color-teal-deep)",
    opacity: 0.6,
    fontSize: 14,
  },
  firstMeetingBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    color: "var(--color-ink)",
    border: "none",
    borderRadius: 9999,
    padding: "11px 22px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
  },
  toolbar: {
    position: "absolute" as const,
    top: 12,
    left: 12,
    zIndex: 5,
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--color-white)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 9999,
    padding: "6px 12px",
  },
  toolbarLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 12,
    color: "var(--color-teal-deep)",
  },
  depthBtn: (active: boolean) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    width: 24,
    height: 24,
    borderRadius: "50%",
    border: `1.5px solid ${active ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: active ? "var(--color-teal-deep)" : "transparent",
    color: active ? "var(--color-white)" : "var(--color-ink)",
    cursor: "pointer",
  }),
  popover: {
    position: "fixed" as const,
    zIndex: 20,
    maxWidth: 260,
    background: "var(--color-ink)",
    color: "var(--color-white)",
    borderRadius: 10,
    padding: "10px 14px",
    fontFamily: "var(--font-body)",
    fontSize: 12,
    lineHeight: 1.5,
    boxShadow: "0px 4px 12px rgba(0,0,0,0.25)",
  },
  popoverType: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--color-mint)",
    marginBottom: 4,
    textTransform: "uppercase" as const,
  },
  mobileList: {
    padding: 16,
    overflowY: "auto" as const,
  },
  mobileRow: {
    padding: "10px 14px",
    borderRadius: 10,
    background: "var(--color-white)",
    border: "1.5px solid var(--color-lavender)",
    marginBottom: 8,
    fontFamily: "var(--font-body)",
    fontSize: 13,
  },
};

type GraphCanvasProps = {
  userId: string;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  isMobile: boolean;
  graphIsEmpty: boolean;
  onLogFirstMeeting: () => void;
};

export function GraphCanvas({
  userId,
  selectedNodeId,
  onSelectNode,
  isMobile,
  graphIsEmpty,
  onLogFirstMeeting,
}: GraphCanvasProps) {
  const [depth, setDepth] = useState(2);
  const [subgraph, setSubgraph] = useState<Subgraph | null>(null);
  const [popover, setPopover] = useState<{ edge: VertexEdge; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selectedNodeId) {
      setSubgraph(null);
      return;
    }
    setPopover(null);
    graphQueryAction(userId, { node_id: selectedNodeId, depth }).then(setSubgraph);
  }, [userId, selectedNodeId, depth]);

  const rfNodes = useMemo(() => (subgraph ? layout(subgraph) : []), [subgraph]);
  const rfEdges = useMemo(() => (subgraph ? buildEdges(subgraph) : []), [subgraph]);

  if (!selectedNodeId) {
    return (
      <div style={s.container}>
        {graphIsEmpty ? (
          <div style={{ ...s.empty, flexDirection: "column", gap: 14, opacity: 1, padding: 24, textAlign: "center" }}>
            <p style={{ margin: 0, maxWidth: 360, opacity: 0.8 }}>
              Your network starts with a meeting: who was there, which group, what came up.
            </p>
            <button type="button" style={s.firstMeetingBtn} onClick={onLogFirstMeeting}>
              Log your first meeting
            </button>
          </div>
        ) : (
          <div style={s.empty}>Select a node to explore its graph.</div>
        )}
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{ ...s.container, ...s.mobileList }}>
        <div style={s.toolbar}>
          <span style={s.toolbarLabel}>Depth</span>
          {[1, 2, 3, 4].map((d) => (
            <button key={d} style={s.depthBtn(d === depth)} onClick={() => setDepth(d)}>
              {d}
            </button>
          ))}
        </div>
        <div style={{ height: 44 }} />
        {subgraph?.nodes.map((node) => (
          <div key={node.id} style={s.mobileRow} onClick={() => onSelectNode(node.id)}>
            <strong>{node.name}</strong> — {node.type}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.toolbar}>
        <span style={s.toolbarLabel}>Depth</span>
        {[1, 2, 3, 4].map((d) => (
          <button key={d} style={s.depthBtn(d === depth)} onClick={() => setDepth(d)}>
            {d}
          </button>
        ))}
      </div>
      <ReactFlow
        key={`${subgraph?.root.id}-${depth}`}
        nodes={rfNodes}
        edges={rfEdges}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onEdgeClick={(event, edge) => {
          const vertexEdge = subgraph?.edges.find((e) => e.id === edge.id);
          if (vertexEdge && (vertexEdge.evidence || vertexEdge.notes)) {
            setPopover({ edge: vertexEdge, x: event.clientX, y: event.clientY });
          }
        }}
        onPaneClick={() => setPopover(null)}
        onInit={(instance: ReactFlowInstance) => {
          if (rfNodes.length === 0) return;
          instance.fitBounds(computeBounds(rfNodes), { padding: 0.15 });
        }}
      >
        <Background />
        <Controls />
      </ReactFlow>
      {popover && (
        <div style={{ ...s.popover, left: popover.x + 12, top: popover.y + 12 }}>
          <p style={s.popoverType}>{popover.edge.type}</p>
          {popover.edge.evidence && <p style={{ margin: "0 0 4px 0" }}>{popover.edge.evidence}</p>}
          {popover.edge.notes && <p style={{ margin: 0, opacity: 0.8 }}>{popover.edge.notes}</p>}
        </div>
      )}
    </div>
  );
}
