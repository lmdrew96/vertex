"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node as RFNode,
  type Edge as RFEdge,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { Edge as VertexEdge, EdgeType, NodeType, VertexNode } from "@/lib/types";
import type { Subgraph } from "@/lib/graph";
import { graphQueryAction } from "./actions";

import { NODE_TYPE_COLOR, NODE_TYPE_TEXT } from "./typeColors";
import { useTheme } from "../../ThemeToggle";

// "via_meeting" only exists in the hide-meetings view: a person drawn straight to a group/topic.
type DisplayEdgeType = EdgeType | "via_meeting";

const EDGE_TYPE_STYLE: Record<
  DisplayEdgeType,
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
  via_meeting: { stroke: "var(--color-mint)", strokeWidth: 2 },
};

// The people → meetings → groups/topics flow. Everything else skips a column and draws lighter.
const MAIN_FLOW = new Set<DisplayEdgeType>(["attended", "held_by", "about", "via_meeting"]);
const SIDE_EDGE_OPACITY = 0.35;
const FADED_OPACITY = 0.12;

// Column per type: people | meetings | groups, then topics.
const COLUMN: Record<NodeType, number> = { person: 0, meeting: 1, group: 2, topic: 2 };
const COLUMN_TITLES = ["People", "Meetings", "Groups & topics"];
const COLUMN_GAP = 320;
const ROW_GAP = 84;
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

type DisplayEdge = {
  id: string;
  from: string;
  to: string;
  type: DisplayEdgeType;
  label: string;
  source?: VertexEdge; // the real edge, for the evidence popover
};

type DisplayGraph = { nodes: VertexNode[]; edges: DisplayEdge[] };

/**
 * What gets drawn. With meetings hidden, each meeting is replaced by edges from its attendees
 * to its groups/topics (one per pair, however many meetings they share). A root meeting stays.
 */
function displayGraph(subgraph: Subgraph, hideMeetings: boolean): DisplayGraph {
  const real = (e: VertexEdge): DisplayEdge => ({ id: e.id, from: e.from, to: e.to, type: e.type, label: e.type, source: e });
  if (!hideMeetings) return { nodes: subgraph.nodes, edges: subgraph.edges.map(real) };

  const hidden = new Set(
    subgraph.nodes.filter((n) => n.type === "meeting" && n.id !== subgraph.root.id).map((n) => n.id),
  );
  const attendees = new Map<string, string[]>();
  const targets = new Map<string, string[]>();
  for (const e of subgraph.edges) {
    if (e.type === "attended" && hidden.has(e.to)) attendees.set(e.to, [...(attendees.get(e.to) ?? []), e.from]);
    if ((e.type === "held_by" || e.type === "about") && hidden.has(e.from)) {
      targets.set(e.from, [...(targets.get(e.from) ?? []), e.to]);
    }
  }
  const via = new Map<string, DisplayEdge & { count: number }>();
  for (const meetingId of hidden) {
    for (const person of attendees.get(meetingId) ?? []) {
      for (const target of targets.get(meetingId) ?? []) {
        const id = `via:${person}:${target}`;
        const existing = via.get(id);
        if (existing) existing.count += 1;
        else via.set(id, { id, from: person, to: target, type: "via_meeting", label: "", count: 1 });
      }
    }
  }
  return {
    nodes: subgraph.nodes.filter((n) => !hidden.has(n.id)),
    edges: [
      ...subgraph.edges.filter((e) => !hidden.has(e.from) && !hidden.has(e.to)).map(real),
      ...[...via.values()].map((e) => ({ ...e, label: `met via ${e.count} meeting${e.count === 1 ? "" : "s"}` })),
    ],
  };
}

const byName = (a: VertexNode, b: VertexNode): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * Deterministic columns. Meetings sort newest first; people and groups/topics are ordered by
 * the average row of their neighbors in other columns (a few barycenter passes), which cuts
 * most crossings. Ties fall back to name, so the same graph always lands the same way.
 */
function columnPositions(graph: DisplayGraph): Map<string, { x: number; y: number }> {
  const neighbors = new Map<string, string[]>();
  for (const e of graph.edges) {
    neighbors.set(e.from, [...(neighbors.get(e.from) ?? []), e.to]);
    neighbors.set(e.to, [...(neighbors.get(e.to) ?? []), e.from]);
  }
  const columns: VertexNode[][] = [[], [], []];
  for (const node of graph.nodes) columns[COLUMN[node.type]].push(node);
  columns[0].sort(byName);
  columns[1].sort((a, b) => {
    const da = a.type === "meeting" ? a.fields.date : "";
    const db = b.type === "meeting" ? b.fields.date : "";
    return db.localeCompare(da) || byName(a, b);
  });
  // Groups above topics.
  const groupsThenTopics = (a: VertexNode, b: VertexNode): number =>
    Number(a.type === "topic") - Number(b.type === "topic");
  columns[2].sort((a, b) => groupsThenTopics(a, b) || byName(a, b));

  const row = new Map<string, number>();
  const place = (col: VertexNode[]) => col.forEach((n, i) => row.set(n.id, i - (col.length - 1) / 2));
  columns.forEach(place);

  const barycenter = (node: VertexNode): number => {
    const rows = (neighbors.get(node.id) ?? [])
      .filter((id) => row.has(id))
      .map((id) => row.get(id)!);
    return rows.length > 0 ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY;
  };
  for (const c of [0, 2, 0, 2]) {
    const bary = new Map(columns[c].map((n) => [n.id, barycenter(n)]));
    columns[c].sort((a, b) => {
      if (c === 2 && groupsThenTopics(a, b) !== 0) return groupsThenTopics(a, b);
      const ba = bary.get(a.id)!;
      const bb = bary.get(b.id)!;
      if (ba !== bb) return ba === Number.POSITIVE_INFINITY ? 1 : bb === Number.POSITIVE_INFINITY ? -1 : ba - bb;
      return byName(a, b);
    });
    place(columns[c]);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of graph.nodes) {
    positions.set(node.id, { x: COLUMN[node.type] * COLUMN_GAP, y: row.get(node.id)! * ROW_GAP });
  }
  return positions;
}

function layout(subgraph: Subgraph, graph: DisplayGraph): RFNode[] {
  const positions = columnPositions(graph);
  return graph.nodes.map((node) => {
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
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
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
        transition: "opacity 0.15s ease",
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

function buildEdges(graph: DisplayGraph): RFEdge[] {
  const column = new Map(graph.nodes.map((n) => [n.id, COLUMN[n.type]]));
  return graph.edges.map((edge) => {
    const style = EDGE_TYPE_STYLE[edge.type];
    // Draw every edge left → right so it leaves a right handle and enters a left one;
    // an edge stored right → left keeps its arrow on the real target end.
    const flip = (column.get(edge.from) ?? 0) > (column.get(edge.to) ?? 0);
    const marker = style.arrow ? { type: MarkerType.ArrowClosed, color: style.stroke } : undefined;
    return {
      id: edge.id,
      source: flip ? edge.to : edge.from,
      target: flip ? edge.from : edge.to,
      data: { label: edge.label, main: MAIN_FLOW.has(edge.type) },
      style: {
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        strokeDasharray: style.dashed ? "6 4" : undefined,
        opacity: MAIN_FLOW.has(edge.type) ? 1 : SIDE_EDGE_OPACITY,
        transition: "opacity 0.15s ease",
      },
      markerEnd: flip ? undefined : marker,
      markerStart: flip ? marker : undefined,
      labelStyle: { fontFamily: "var(--font-mono)", fontSize: 10 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    };
  });
}

function LegendSwatch({ type }: { type: DisplayEdgeType }) {
  const style = EDGE_TYPE_STYLE[type];
  return (
    <svg width="26" height="8" aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="25"
        y2="4"
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dashed ? "6 4" : undefined}
        opacity={MAIN_FLOW.has(type) ? 1 : SIDE_EDGE_OPACITY + 0.25}
      />
    </svg>
  );
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
    color: "var(--color-on-light)",
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
    color: "var(--color-lavender)",
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
  toggleBtn: (active: boolean) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12,
    borderRadius: 9999,
    padding: "3px 10px",
    border: `1.5px solid ${active ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: active ? "var(--color-teal-deep)" : "transparent",
    color: active ? "var(--color-white)" : "var(--color-ink)",
    cursor: "pointer",
  }),
  divider: { width: 1, height: 18, background: "var(--color-lavender)" },
  legend: {
    position: "absolute" as const,
    top: 12,
    right: 12,
    zIndex: 5,
    background: "var(--color-white)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 10,
    padding: "8px 12px",
    display: "grid",
    gridTemplateColumns: "auto auto",
    columnGap: 8,
    rowGap: 3,
    alignItems: "center",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--color-ink)",
  },
  columnTitle: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    textTransform: "uppercase" as const,
    color: "var(--color-teal-deep)",
    margin: "14px 0 6px",
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
  const [hideMeetings, setHideMeetings] = useState(false);
  const [subgraph, setSubgraph] = useState<Subgraph | null>(null);
  const [popover, setPopover] = useState<{ edge: VertexEdge; x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!selectedNodeId) {
      setSubgraph(null);
      return;
    }
    setPopover(null);
    setHoveredNode(null);
    setHoveredEdge(null);
    graphQueryAction(userId, { node_id: selectedNodeId, depth }).then(setSubgraph);
  }, [userId, selectedNodeId, depth]);

  const graph = useMemo(() => (subgraph ? displayGraph(subgraph, hideMeetings) : null), [subgraph, hideMeetings]);
  const rfNodes = useMemo(() => (subgraph && graph ? layout(subgraph, graph) : []), [subgraph, graph]);
  const rfEdges = useMemo(() => (graph ? buildEdges(graph) : []), [graph]);
  const legendTypes = useMemo(
    () => (Object.keys(EDGE_TYPE_STYLE) as DisplayEdgeType[]).filter((t) => graph?.edges.some((e) => e.type === t)),
    [graph],
  );

  // Hover focus: the hovered node and its direct neighbors stay lit, everything else fades.
  const focus = useMemo(() => {
    if (!hoveredNode) return null;
    const lit = new Set([hoveredNode]);
    for (const e of rfEdges) {
      if (e.source === hoveredNode) lit.add(e.target);
      if (e.target === hoveredNode) lit.add(e.source);
    }
    return lit;
  }, [hoveredNode, rfEdges]);

  const shownNodes = useMemo<RFNode[]>(
    () =>
      focus
        ? rfNodes.map((n) => ({ ...n, style: { ...n.style, opacity: focus.has(n.id) ? 1 : FADED_OPACITY } }))
        : rfNodes,
    [rfNodes, focus],
  );
  const shownEdges = useMemo<RFEdge[]>(
    () =>
      rfEdges.map((e) => {
        const touches = hoveredNode ? e.source === hoveredNode || e.target === hoveredNode : true;
        const base = (e.data as { main: boolean }).main ? 1 : SIDE_EDGE_OPACITY;
        return {
          ...e,
          label: e.id === hoveredEdge ? (e.data as { label: string }).label : undefined,
          style: { ...e.style, opacity: touches ? (hoveredNode ? 1 : base) : FADED_OPACITY / 2 },
        };
      }),
    [rfEdges, hoveredNode, hoveredEdge],
  );

  const rootIsMeeting = subgraph?.root.type === "meeting";

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

  const toolbar = (
    <div style={s.toolbar}>
      <span style={s.toolbarLabel}>Depth</span>
      {[1, 2, 3, 4].map((d) => (
        <button key={d} style={s.depthBtn(d === depth)} onClick={() => setDepth(d)}>
          {d}
        </button>
      ))}
      <span style={s.divider} />
      <button
        type="button"
        style={s.toggleBtn(hideMeetings)}
        onClick={() => setHideMeetings((x) => !x)}
        aria-pressed={hideMeetings}
        title={
          rootIsMeeting
            ? "The selected meeting stays; other meetings collapse into who-knows-who lines."
            : "Draw people straight to the groups and topics their meetings link to."
        }
      >
        Hide meetings
      </button>
    </div>
  );

  if (isMobile) {
    // Phone width: the same three columns, stacked.
    const columns: VertexNode[][] = [[], [], []];
    if (graph) {
      const positions = columnPositions(graph);
      for (const node of [...graph.nodes].sort((a, b) => positions.get(a.id)!.y - positions.get(b.id)!.y)) {
        columns[COLUMN[node.type]].push(node);
      }
    }
    return (
      <div style={{ ...s.container, ...s.mobileList }}>
        {toolbar}
        <div style={{ height: 44 }} />
        {columns.map((nodes, c) =>
          nodes.length === 0 ? null : (
            <div key={c}>
              <p style={s.columnTitle}>{COLUMN_TITLES[c]}</p>
              {nodes.map((node) => (
                <div
                  key={node.id}
                  style={{
                    ...s.mobileRow,
                    borderLeft: `6px solid ${NODE_TYPE_COLOR[node.type]}`,
                    fontWeight: node.id === subgraph?.root.id ? 600 : undefined,
                  }}
                  onClick={() => onSelectNode(node.id)}
                >
                  <strong>{node.name}</strong> · {node.type}
                </div>
              ))}
            </div>
          ),
        )}
      </div>
    );
  }

  return (
    <div style={s.container}>
      {toolbar}
      {legendTypes.length > 0 && (
        <div style={s.legend} aria-label="Edge legend">
          {legendTypes.map((t) => (
            <span key={t} style={{ display: "contents" }}>
              <LegendSwatch type={t} />
              <span>{t === "via_meeting" ? "met via meeting" : t}</span>
            </span>
          ))}
        </div>
      )}
      <ReactFlow
        key={`${subgraph?.root.id}-${depth}-${hideMeetings}`}
        nodes={shownNodes}
        edges={shownEdges}
        colorMode={theme}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onNodeMouseEnter={(_, node) => setHoveredNode(node.id)}
        onNodeMouseLeave={() => setHoveredNode(null)}
        onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
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
