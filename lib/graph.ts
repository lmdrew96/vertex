import { getEdge, getEdgesFrom, getEdgesTo } from "./edges";
import { autoArchiveStaleOrphans, getNode, resolveNode } from "./nodes";
import type { Edge, EdgeType, VertexNode } from "./types";

export type Subgraph = {
  root: VertexNode;
  nodes: VertexNode[];
  edges: Edge[];
  depth: number;
  nodeCount: number;
  edgeCount: number;
  autoArchived?: string[];
};

// ── BFS traversal ────────────────────────────────────────────────────────────

export const graphQuery = async (
  userId: string,
  opts: {
    node_id: string;
    depth?: number;
    edge_types?: EdgeType[];
  },
): Promise<Subgraph> => {
  const { node_id, depth = 2, edge_types } = opts;

  if (depth < 1 || depth > 4) {
    throw new Error("Depth must be between 1 and 4. Deeper traversals are expensive — query a closer neighborhood first.");
  }

  // Lazy orphan auto-archive.
  const autoArchived = await autoArchiveStaleOrphans(userId);

  const root = await resolveNode(userId, node_id);
  if (!root) {
    throw new Error(`Node '${node_id}' not found. Use vtx_node_search to find the right ID.`);
  }

  const visitedNodes = new Map<string, VertexNode>();
  const visitedEdges = new Map<string, Edge>();
  visitedNodes.set(root.id, root);

  let frontier = [root.id];

  for (let hop = 0; hop < depth; hop++) {
    if (frontier.length === 0) break;

    const nextFrontier: string[] = [];

    await Promise.all(
      frontier.map(async (nodeId) => {
        const [outgoing, incoming] = await Promise.all([
          getEdgesFrom(userId, nodeId),
          getEdgesTo(userId, nodeId),
        ]);

        const allEdges = [...outgoing, ...incoming];

        for (const edge of allEdges) {
          if (edge_types && !edge_types.includes(edge.type)) continue;
          if (visitedEdges.has(edge.id)) continue;

          visitedEdges.set(edge.id, edge);

          const otherId = edge.from === nodeId ? edge.to : edge.from;
          if (!visitedNodes.has(otherId)) {
            const other = await getNode(userId, otherId);
            if (other && other.status !== "archived") {
              visitedNodes.set(otherId, other);
              nextFrontier.push(otherId);
            }
          }
        }
      }),
    );

    frontier = nextFrontier;
  }

  const nodes = Array.from(visitedNodes.values());
  const edges = Array.from(visitedEdges.values());

  return {
    root,
    nodes,
    edges,
    depth,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    autoArchived: autoArchived.length > 0 ? autoArchived : undefined,
  };
};

// ── Mermaid render ────────────────────────────────────────────────────────────

export const graphRender = async (
  userId: string,
  opts: {
    node_id: string;
    depth?: number;
    edge_types?: EdgeType[];
  },
): Promise<{ diagram: string; autoArchived?: string[] }> => {
  const subgraph = await graphQuery(userId, opts);

  const lines: string[] = ["graph LR"];

  for (const node of subgraph.nodes) {
    if (node.status === "archived") continue;
    const label = `"${node.name}\\n(${node.type})"`;
    lines.push(`  ${node.id}[${label}]`);
  }

  for (const edge of subgraph.edges) {
    lines.push(`  ${edge.from} -->|"${edge.type}"| ${edge.to}`);
  }

  return {
    diagram: lines.join("\n"),
    autoArchived: subgraph.autoArchived,
  };
};

// ── Node + edges hydration (used by vtx_node_get) ────────────────────────────

export const getNodeWithEdges = async (
  userId: string,
  idOrName: string,
): Promise<{
  node: VertexNode;
  edges: {
    outgoing: Array<{ edge: Edge; target: VertexNode }>;
    incoming: Array<{ edge: Edge; source: VertexNode }>;
  };
} | null> => {
  const node = await resolveNode(userId, idOrName);
  if (!node) return null;

  const [outEdges, inEdges] = await Promise.all([
    getEdgesFrom(userId, node.id),
    getEdgesTo(userId, node.id),
  ]);

  const outgoing = (
    await Promise.all(
      outEdges.map(async (edge) => {
        const target = await getNode(userId, edge.to);
        return target ? { edge, target } : null;
      }),
    )
  ).filter((x): x is { edge: Edge; target: VertexNode } => x !== null);

  const incoming = (
    await Promise.all(
      inEdges.map(async (edge) => {
        const source = await getNode(userId, edge.from);
        return source ? { edge, source } : null;
      }),
    )
  ).filter((x): x is { edge: Edge; source: VertexNode } => x !== null);

  return { node, edges: { outgoing, incoming } };
};
