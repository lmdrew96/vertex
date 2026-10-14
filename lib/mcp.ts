import { deleteEdge, createEdge } from "./edges";
import { graphQuery, graphRender, getNodeWithEdges } from "./graph";
import {
  archiveNode,
  autoArchiveStaleOrphans,
  createNode,
  getOrphanIds,
  getNode,
  searchNodes,
  updateNode,
} from "./nodes";
import {
  EDGE_TYPES,
  GROUP_KINDS,
  NODE_TYPES,
  type EdgeType,
  type NodeCreateInput,
  type NodeType,
} from "./types";

// ── Envelope helpers ─────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export const ok = (id: unknown, result: unknown): Response =>
  Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS_HEADERS });

export const err = (id: unknown, code: number, message: string): Response =>
  Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { headers: CORS_HEADERS },
  );

const textContent = (payload: unknown) => ({
  content: [
    {
      type: "text",
      text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
    },
  ],
});

// ── Tool definitions ─────────────────────────────────────────────────────────

const FIELDS_SCHEMA = {
  type: "object",
  description:
    "Type-specific fields, all optional except meeting.date. person: role, affiliation, email, howWeMet. group: kind, url. meeting: date (YYYY-MM-DD, required), ccEventId, notes (markdown), followUpTaskIds (ControlledChaos task IDs). topic: none.",
  properties: {
    role: { type: "string", description: 'person — e.g. "AAP Director".' },
    affiliation: { type: "string", description: "person — where they work or study." },
    email: { type: "string", description: "person" },
    howWeMet: { type: "string", description: "person" },
    kind: { type: "string", enum: GROUP_KINDS, description: "group" },
    url: { type: "string", description: "group" },
    date: { type: "string", description: "meeting — YYYY-MM-DD." },
    ccEventId: { type: "string", description: "meeting — ControlledChaos event ID." },
    notes: { type: "string", description: "meeting — markdown notes." },
    followUpTaskIds: {
      type: "array",
      items: { type: "string" },
      description: "meeting — ControlledChaos task IDs for follow-ups.",
    },
  },
} as const;

const ORPHAN_HINT: Record<NodeType, string> = {
  person: "add member_of (→ group), attended (→ meeting), or can_help_with (→ topic)",
  group: "add member_of (person →) or held_by (meeting →)",
  meeting: "add attended (person →), held_by (→ group), or about (→ topic)",
  topic: "add about (meeting →), involved_in or can_help_with (person →)",
};

export const TOOLS = [
  {
    name: "vtx_node_create",
    description:
      "Create a node in Nae's people graph: a person, group (org/council/team/class/program), meeting, or topic. Generates a slug ID from the name. Starts as an orphan — connect it with vtx_edge_create within 7 days or it will be auto-archived.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: NODE_TYPES, description: "Node type." },
        name: {
          type: "string",
          description:
            'Human-readable name, e.g. "Art Trembanis" or "PSAC". Required except for meetings, which default to the date.',
        },
        description: { type: "string", description: "Optional — who or what this is, 1-3 sentences." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: 'Optional tags, e.g. ["ud", "mentorship"].',
        },
        fields: FIELDS_SCHEMA,
      },
      required: ["type"],
    },
  },
  {
    name: "vtx_node_get",
    description:
      "Fetch a single node (including its type-specific fields) plus all its edges (both directions). Accepts node ID or name (fuzzy match).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Node ID or name (fuzzy match on name if no exact match)." },
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_node_update",
    description:
      "Update the name, description, tags, or type-specific fields on an existing node. Fields merge into what's there; pass null for a field to clear it (a meeting's date can't be cleared).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        fields: FIELDS_SCHEMA,
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_node_archive",
    description:
      "Soft-delete a node. Sets status to 'archived'. Edges remain for data integrity but the node is excluded from graph traversals.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_node_search",
    description:
      "Full-text search across node names and descriptions. Case-insensitive substring match. Name matches rank above description matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        type: { type: "string", enum: NODE_TYPES, description: "Optional filter by node type." },
        include_archived: { type: "boolean", description: "Include archived nodes. Default false." },
      },
      required: ["query"],
    },
  },
  {
    name: "vtx_orphans_list",
    description:
      "Returns all nodes with no edges, sorted by days orphaned (most neglected first). Auto-archives nodes orphaned for more than 7 days.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "vtx_edge_create",
    description:
      "Connect two existing nodes with a directed, typed edge. Allowed pairs: member_of person → group; attended person → meeting; held_by meeting → group; about meeting → topic; involved_in person/group → topic; can_help_with person → topic; introduced person → person (A introduced Nae to B); connects_to any → any (say how in notes).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Source node ID." },
        to: { type: "string", description: "Target node ID." },
        type: { type: "string", enum: EDGE_TYPES, description: "Relationship type." },
        evidence: { type: "string", description: "Optional source or rationale, e.g. where Nae learned this." },
        notes: { type: "string", description: "Optional free text." },
      },
      required: ["from", "to", "type"],
    },
  },
  {
    name: "vtx_edge_delete",
    description:
      "Remove an edge between two nodes. If either endpoint becomes isolated, it's returned to the orphans set.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Edge ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_graph_query",
    description:
      "BFS traversal from a starting node outward to `depth` hops. Returns all reachable nodes and edges within that depth. Auto-archives stale orphans on call.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "Starting node ID or name." },
        depth: {
          type: "number",
          description: "Traversal depth, 1–4. Default 2.",
        },
        edge_types: {
          type: "array",
          items: { type: "string", enum: EDGE_TYPES },
          description: "Optional filter — only traverse these edge types.",
        },
      },
      required: ["node_id"],
    },
  },
  {
    name: "vtx_graph_render",
    description:
      "Run a BFS traversal and return the result as a Mermaid `graph LR` diagram string, e.g. to show who connects to a group or topic.",
    inputSchema: {
      type: "object",
      properties: {
        node_id: { type: "string", description: "Starting node ID or name." },
        depth: { type: "number", description: "Traversal depth, 1–4. Default 2." },
        edge_types: {
          type: "array",
          items: { type: "string", enum: EDGE_TYPES },
          description: "Optional filter — only traverse these edge types.",
        },
      },
      required: ["node_id"],
    },
  },
] as const;

export const SERVER_INFO = {
  name: "vertex-mcp",
  version: "1.1.0",
  protocolVersion: "2024-11-05",
};

// ── Dispatcher ───────────────────────────────────────────────────────────────

export type DispatchContext = {
  userId: string;
};

type ToolArgs = Record<string, unknown>;
type ToolResult = ReturnType<typeof textContent>;

export class ToolError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

// ── Arg coercers ─────────────────────────────────────────────────────────────

const asString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

const asNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

const asBoolean = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

const asStringArray = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;

const asNodeType = (v: unknown): NodeType | undefined =>
  typeof v === "string" && (NODE_TYPES as readonly string[]).includes(v)
    ? (v as NodeType)
    : undefined;

const asEdgeType = (v: unknown): EdgeType | undefined =>
  typeof v === "string" && (EDGE_TYPES as readonly string[]).includes(v)
    ? (v as EdgeType)
    : undefined;

const asEdgeTypeArray = (v: unknown): EdgeType[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: EdgeType[] = [];
  for (const x of v) {
    const t = asEdgeType(x);
    if (!t) return undefined;
    out.push(t);
  }
  return out;
};

// ── Dispatch ─────────────────────────────────────────────────────────────────

export const dispatchTool = async (
  name: string,
  args: ToolArgs,
  ctx: DispatchContext,
): Promise<ToolResult> => {
  const { userId } = ctx;

  switch (name) {
    case "vtx_node_create": {
      const type = asNodeType(args.type);
      if (!type) {
        throw new ToolError(-32602, `vtx_node_create requires type: ${NODE_TYPES.join(", ")}`);
      }
      try {
        // createNode validates fields against the type at runtime.
        const node = await createNode(userId, {
          type,
          name: asString(args.name),
          description: asString(args.description),
          tags: asStringArray(args.tags),
          fields: args.fields,
        } as NodeCreateInput);
        return textContent({
          node,
          warning: `No edges yet — this ${type} auto-archives in 7 days unless connected. Next: ${ORPHAN_HINT[type]}.`,
        });
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Failed to create node");
      }
    }

    case "vtx_node_get": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_node_get requires id");
      const result = await getNodeWithEdges(userId, id);
      if (!result) {
        throw new ToolError(
          -32602,
          `Node '${id}' not found. Use vtx_node_search to find the right ID.`,
        );
      }
      return textContent(result);
    }

    case "vtx_node_update": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_node_update requires id");
      let updated;
      try {
        updated = await updateNode(userId, id, {
          name: asString(args.name),
          description: asString(args.description),
          tags: asStringArray(args.tags),
          fields: args.fields as Record<string, unknown> | undefined,
        });
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Failed to update node");
      }
      if (!updated) {
        throw new ToolError(
          -32602,
          `Node '${id}' not found. Use vtx_node_search to find the right ID.`,
        );
      }
      return textContent(updated);
    }

    case "vtx_node_archive": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_node_archive requires id");
      const archived = await archiveNode(userId, id);
      if (!archived) {
        throw new ToolError(
          -32602,
          `Node '${id}' not found. Use vtx_node_search to find the right ID.`,
        );
      }
      return textContent(`Archived node: ${archived.name} (${archived.id})`);
    }

    case "vtx_node_search": {
      const query = asString(args.query);
      if (!query) throw new ToolError(-32602, "vtx_node_search requires query");
      const nodes = await searchNodes(userId, {
        query,
        type: asNodeType(args.type),
        include_archived: asBoolean(args.include_archived),
      });
      return textContent({ nodes, count: nodes.length });
    }

    case "vtx_orphans_list": {
      const autoArchived = await autoArchiveStaleOrphans(userId);
      const orphanIds = await getOrphanIds(userId);

      const orphanNodes = (
        await Promise.all(orphanIds.map((id) => getNode(userId, id)))
      ).filter((n) => n !== null && n.status === "active");

      const now = Date.now();
      const result = orphanNodes
        .map((node) => ({
          node,
          createdAt: node!.createdAt,
          daysOrphaned: Math.floor(
            (now - new Date(node!.createdAt).getTime()) / (24 * 60 * 60 * 1000),
          ),
        }))
        .sort((a, b) => b.daysOrphaned - a.daysOrphaned);

      return textContent({
        orphans: result,
        count: result.length,
        autoArchived: autoArchived.length > 0 ? autoArchived : undefined,
      });
    }

    case "vtx_edge_create": {
      const from = asString(args.from);
      const to = asString(args.to);
      const type = asEdgeType(args.type);
      if (!from || !to || !type) {
        throw new ToolError(-32602, "vtx_edge_create requires from, to, type");
      }
      try {
        const result = await createEdge(userId, {
          from,
          to,
          type,
          evidence: asString(args.evidence),
          notes: asString(args.notes),
        });
        return textContent(result);
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Failed to create edge");
      }
    }

    case "vtx_edge_delete": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_edge_delete requires id");
      const deleted = await deleteEdge(userId, id);
      if (!deleted) {
        throw new ToolError(-32602, `Edge '${id}' not found.`);
      }
      return textContent(`Deleted edge: ${id}`);
    }

    case "vtx_graph_query": {
      const node_id = asString(args.node_id);
      if (!node_id) throw new ToolError(-32602, "vtx_graph_query requires node_id");
      const depth = asNumber(args.depth);
      if (depth !== undefined && (depth < 1 || depth > 4)) {
        throw new ToolError(
          -32602,
          "Depth must be between 1 and 4. Deeper traversals are expensive — query a closer neighborhood first.",
        );
      }
      try {
        const result = await graphQuery(userId, {
          node_id,
          depth,
          edge_types: asEdgeTypeArray(args.edge_types),
        });
        return textContent(result);
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Graph query failed");
      }
    }

    case "vtx_graph_render": {
      const node_id = asString(args.node_id);
      if (!node_id) throw new ToolError(-32602, "vtx_graph_render requires node_id");
      const depth = asNumber(args.depth);
      if (depth !== undefined && (depth < 1 || depth > 4)) {
        throw new ToolError(
          -32602,
          "Depth must be between 1 and 4. Deeper traversals are expensive — query a closer neighborhood first.",
        );
      }
      try {
        const result = await graphRender(userId, {
          node_id,
          depth,
          edge_types: asEdgeTypeArray(args.edge_types),
        });
        return textContent(result);
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Graph render failed");
      }
    }

    default:
      throw new ToolError(-32601, `Unknown tool: ${name}`);
  }
};
