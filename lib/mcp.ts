import { archiveEdge, createEdge, deleteEdge, getArchivedEdges, restoreEdge } from "./edges";
import { graphQuery, graphRender, getNodeWithEdges } from "./graph";
import {
  ALLOWED_TYPES,
  deleteAttachment,
  getAttachmentWithUrl,
  linkAttachment,
  listNodeAttachments,
  requestUpload,
  setAttachmentText,
  summarize,
} from "./attachments";
import { brief, whoKnows } from "./brief";
import { confirmAndExtract, extractAttachment } from "./extract";
import { R2NotConfiguredError } from "./r2";
import { logMeeting } from "./meetings";
import {
  archiveNode,
  autoArchiveStaleOrphans,
  createNode,
  getOrphanIds,
  getNode,
  searchNodeHits,
  updateNode,
} from "./nodes";
import {
  EDGE_TYPES,
  GROUP_KINDS,
  MEETING_KINDS,
  NODE_TYPES,
  type EdgeType,
  type MeetingKind,
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
    "Type-specific fields, all optional except meeting.date. person: role, affiliation, email, howWeMet. group: kind, url. meeting (also used for events): date (YYYY-MM-DD, required), kind (meeting | event), ccEventId, notes (markdown), followUpTaskIds (ControlledChaos task IDs). topic: none.",
  properties: {
    role: { type: "string", description: 'person — e.g. "AAP Director".' },
    affiliation: { type: "string", description: "person — where they work or study." },
    email: { type: "string", description: "person" },
    howWeMet: { type: "string", description: "person" },
    kind: {
      type: "string",
      enum: [...GROUP_KINDS, ...MEETING_KINDS],
      description: `group: ${GROUP_KINDS.join(" | ")}. meeting: ${MEETING_KINDS.join(" | ")} (a luncheon, talk, or reception is an event; unset means meeting).`,
    },
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
  group: "add member_of (person →), held_by (meeting →), or involved_in (→ meeting or topic)",
  meeting: "add attended (person →), held_by (→ group), about (→ topic), or involved_in (group →)",
  topic: "add about (meeting →), involved_in or can_help_with (person →)",
};

export const TOOLS = [
  {
    name: "vtx_node_create",
    description:
      "Create a node in Nae's people graph: a person, group (org/council/team/class/program), meeting (or event: set fields.kind \"event\" for a luncheon, talk, reception…), or topic. Generates a slug ID from the name. Starts as an orphan — connect it with vtx_edge_create within 7 days or it will be auto-archived.",
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
      "Fetch a single node (including its type-specific fields), all its edges (both directions), and its attachments (metadata + short textPreview; use vtx_attachment_get for the full text and a download link). Accepts node ID or name (fuzzy match).",
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
      "Case-insensitive substring search across node names, descriptions, meeting notes, and attachment text. Ranked name > description > notes > attachment; each result says where it matched (matchedIn, plus the file for attachment matches).",
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
      "Connect two existing nodes with a directed, typed edge. Allowed pairs: member_of person → group; attended person → meeting; held_by meeting → group; about meeting → topic; involved_in person/group → topic or group → meeting (a group involved in a meeting it didn't host); can_help_with person → topic; introduced person → person (A introduced Nae to B); connects_to any → any (say how in notes). An archived endpoint is reactivated; the response lists it under reactivated.",
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
      "Permanently remove an edge (active or archived). If either endpoint becomes isolated, it's returned to the orphans set. To hide an edge but keep it, use vtx_edge_archive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Edge ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_edge_archive",
    description:
      "Archive an edge: it stays stored but drops out of traversals, briefs, who-knows, and orphan checks (an endpoint left with no active edges becomes an orphan). vtx_node_get lists a node's archived edges; vtx_edge_restore brings one back.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Edge ID." },
      },
      required: ["id"],
    },
  },
  {
    name: "vtx_edge_restore",
    description:
      "Restore an archived edge. Both endpoints must still exist; an archived endpoint is reactivated (listed under reactivated).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Edge ID (from archivedEdges in vtx_node_get)." },
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
  {
    name: "vtx_meeting_log",
    description:
      "Log a whole meeting or event in one call (set kind \"event\" for a luncheon, talk, reception…): creates the meeting node, matches or creates attendees (person), the group, and topics, and connects them (attended, held_by, about). Names match case-insensitively against existing nodes of the right type. It never guesses: if a name is ambiguous, only similar to an existing person (\"Trembanis\" vs \"Art Trembanis\"), or matches an archived node, it returns status \"needs_choice\" with candidates and creates NOTHING. Re-call with the chosen node ID in place of the name, or list the name in confirm_new to create a new node. Passing an archived node's ID reactivates it. Needs at least one attendee or a group. Stores ControlledChaos IDs only.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Meeting date, YYYY-MM-DD (Nae's local date)." },
        name: {
          type: "string",
          description: 'Optional. Defaults to "{date} · {group or first attendee}", e.g. "2026-10-14 · PSAC".',
        },
        kind: {
          type: "string",
          enum: MEETING_KINDS,
          description: 'Optional. "event" for a luncheon, talk, reception, or similar; default "meeting".',
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "People at the meeting (names or node IDs), not counting Nae. Unknown names become new person nodes.",
        },
        group: { type: "string", description: "Optional. The group whose meeting this was (name or node ID)." },
        topics: {
          type: "array",
          items: { type: "string" },
          description: "Topics covered (names or node IDs). Unknown names become new topic nodes.",
        },
        notes: { type: "string", description: "Optional markdown notes." },
        cc_event_id: { type: "string", description: "Optional ControlledChaos event ID." },
        follow_up_task_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional ControlledChaos task IDs for follow-ups already created there.",
        },
        confirm_new: {
          type: "array",
          items: { type: "string" },
          description: "Names to create as NEW nodes even though similar ones exist (use after a needs_choice).",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "vtx_brief",
    description:
      "Pre-meeting brief for a person, group, topic, or meeting: the node and its fields, lastContact (most recent meeting date), recentMeetings (newest first, with notes excerpts), connected people (role, affiliation, and how they link), groups, topics, and openFollowUps (ControlledChaos task IDs from those meetings; check their status in ControlledChaos). Accepts an ID or name; if a name matches several nodes, returns status \"needs_choice\" with candidates.",
    inputSchema: {
      type: "object",
      properties: {
        node: { type: "string", description: "Node ID or name (exact or partial)." },
        limit_meetings: { type: "number", description: "How many recent meetings to include, 1–20. Default 5." },
      },
      required: ["node"],
    },
  },
  {
    name: "vtx_who_knows",
    description:
      "\"Who do I know who…\": finds people connected to a topic or phrase, ranked can_help_with > involved_in > mentioned (at a meeting about it, in meeting notes, or in their own profile). Each person comes with `why`, the paths that link them, so Nae sees the reason.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'A topic or free text, e.g. "public service".' },
      },
      required: ["query"],
    },
  },
  {
    name: "vtx_attachment_request_upload",
    description:
      `Step 1 of attaching a file (image, PDF, DOCX, text, markdown; max 10 MB) to one or more nodes. Files are attachments, never nodes. Returns attachment_id and a presigned upload_url (valid 15 minutes). Step 2: PUT the raw bytes to upload_url with header "Content-Type" exactly equal to content_type. Step 3: call vtx_attachment_confirm. Allowed types: ${ALLOWED_TYPES.join(", ")}. HEIC/HEIF (iPhone photos) is rejected, so convert to JPEG first.`,
    inputSchema: {
      type: "object",
      properties: {
        node_ids: {
          type: "array",
          items: { type: "string" },
          description: "Exact node IDs to attach the file to (at least one).",
        },
        filename: { type: "string", description: 'Original filename, e.g. "psac-agenda.pdf".' },
        content_type: { type: "string", description: 'MIME type, e.g. "application/pdf".' },
        size: { type: "number", description: "File size in bytes." },
        caption: { type: "string", description: "Optional short caption." },
      },
      required: ["node_ids", "filename", "content_type", "size"],
    },
  },
  {
    name: "vtx_attachment_confirm",
    description:
      "Step 3 of attaching a file, after the bytes are PUT to upload_url. Checks the stored file's real type and size, then saves the attachment. If you've already read the file in chat, pass its full text as extracted_text (handwriting transcribed, nothing summarized). That's saved as-is, with no server-side cost. Otherwise the server extracts the text now (PDF text layer, DOCX, TXT/MD, or a Claude transcription for photos and scanned PDFs). Photos and scans come back \"not_transcribed\" when the server has no model key; that's expected, so read the file yourself and send the text with vtx_attachment_set_text. A real failure still saves the upload, with extractStatus \"failed\" and an extractError; retry with vtx_attachment_extract. Confirming twice is harmless.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        extracted_text: {
          type: "string",
          description: "Optional full text of the file (stored up to 50k characters).",
        },
      },
      required: ["attachment_id"],
    },
  },
  {
    name: "vtx_attachment_extract",
    description:
      "Re-run server-side text extraction for an attachment, e.g. after extractStatus \"failed\". Returns the updated status and a text preview. Doesn't run on files whose text was provided at upload.",
    inputSchema: {
      type: "object",
      properties: { attachment_id: { type: "string" } },
      required: ["attachment_id"],
    },
  },
  {
    name: "vtx_attachment_set_text",
    description:
      "Save the text of an existing attachment, e.g. after you read a photo or scan that shows extractStatus \"not_transcribed\". Transcribe exactly (handwriting included, nothing summarized) and pass the full text. It's stored as \"provided\" (up to 50k characters) and replaces any earlier text, so this also fixes a bad transcription.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        text: { type: "string", description: "The file's full text." },
      },
      required: ["attachment_id", "text"],
    },
  },
  {
    name: "vtx_attachment_get",
    description:
      "Get one attachment: metadata, its full extracted text, and a download URL that works for 1 hour.",
    inputSchema: {
      type: "object",
      properties: { attachment_id: { type: "string" } },
      required: ["attachment_id"],
    },
  },
  {
    name: "vtx_attachment_link",
    description:
      "Hang an existing attachment on more nodes, or take it off some. It must stay on at least one node.",
    inputSchema: {
      type: "object",
      properties: {
        attachment_id: { type: "string" },
        add_node_ids: { type: "array", items: { type: "string" } },
        remove_node_ids: { type: "array", items: { type: "string" } },
      },
      required: ["attachment_id"],
    },
  },
  {
    name: "vtx_attachment_delete",
    description: "Permanently delete an attachment: the stored file first, then its record.",
    inputSchema: {
      type: "object",
      properties: { attachment_id: { type: "string" } },
      required: ["attachment_id"],
    },
  },
] as const;

export const SERVER_INFO = {
  name: "vertex-mcp",
  version: "1.7.0",
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
      const [attachments, archivedEdges] = await Promise.all([
        listNodeAttachments(userId, result.node.id).then((atts) => atts.map(summarize)),
        getArchivedEdges(userId, result.node.id),
      ]);
      return textContent({ ...result, attachments, ...(archivedEdges.length > 0 ? { archivedEdges } : {}) });
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
      const results = await searchNodeHits(userId, {
        query,
        type: asNodeType(args.type),
        include_archived: asBoolean(args.include_archived),
      });
      return textContent({ results, count: results.length });
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

    case "vtx_edge_archive": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_edge_archive requires id");
      const edge = await archiveEdge(userId, id);
      if (!edge) throw new ToolError(-32602, `Edge '${id}' not found.`);
      return textContent({ archived: edge, hint: "Restore it with vtx_edge_restore." });
    }

    case "vtx_edge_restore": {
      const id = asString(args.id);
      if (!id) throw new ToolError(-32602, "vtx_edge_restore requires id");
      try {
        const result = await restoreEdge(userId, id);
        if (!result) throw new Error(`Edge '${id}' not found.`);
        return textContent(result);
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Failed to restore edge");
      }
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

    case "vtx_meeting_log": {
      const date = asString(args.date);
      if (!date) throw new ToolError(-32602, "vtx_meeting_log requires date (YYYY-MM-DD)");
      const kind = asString(args.kind);
      if (kind !== undefined && !(MEETING_KINDS as string[]).includes(kind)) {
        throw new ToolError(-32602, `kind must be one of: ${MEETING_KINDS.join(", ")}`);
      }
      for (const key of ["attendees", "topics", "follow_up_task_ids", "confirm_new"]) {
        if (args[key] !== undefined && !asStringArray(args[key])) {
          throw new ToolError(-32602, `${key} must be an array of strings`);
        }
      }
      try {
        const result = await logMeeting(userId, {
          date,
          name: asString(args.name),
          kind: kind as MeetingKind | undefined,
          attendees: asStringArray(args.attendees),
          group: asString(args.group),
          topics: asStringArray(args.topics),
          notes: asString(args.notes),
          ccEventId: asString(args.cc_event_id),
          followUpTaskIds: asStringArray(args.follow_up_task_ids),
          confirmNew: asStringArray(args.confirm_new),
        });
        return textContent(result);
      } catch (e) {
        throw new ToolError(-32602, e instanceof Error ? e.message : "Failed to log meeting");
      }
    }

    case "vtx_brief": {
      const node = asString(args.node);
      if (!node) throw new ToolError(-32602, "vtx_brief requires node");
      const limit = asNumber(args.limit_meetings);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
        throw new ToolError(-32602, "limit_meetings must be a whole number from 1 to 20");
      }
      const result = await brief(userId, node, limit);
      if (!result) {
        throw new ToolError(-32602, `Node '${node}' not found. Use vtx_node_search to find the right ID.`);
      }
      return textContent(result);
    }

    case "vtx_who_knows": {
      const query = asString(args.query);
      if (!query?.trim()) throw new ToolError(-32602, "vtx_who_knows requires query");
      return textContent(await whoKnows(userId, query));
    }

    case "vtx_attachment_request_upload":
    case "vtx_attachment_confirm":
    case "vtx_attachment_extract":
    case "vtx_attachment_set_text":
    case "vtx_attachment_get":
    case "vtx_attachment_link":
    case "vtx_attachment_delete":
      return attachmentTool(name, args, userId);

    default:
      throw new ToolError(-32601, `Unknown tool: ${name}`);
  }
};

// ── Attachment tools ─────────────────────────────────────────────────────────

const attachmentTool = async (name: string, args: ToolArgs, userId: string): Promise<ToolResult> => {
  const attachmentId = asString(args.attachment_id);
  if (name !== "vtx_attachment_request_upload" && !attachmentId) {
    throw new ToolError(-32602, `${name} requires attachment_id`);
  }
  try {
    switch (name) {
      case "vtx_attachment_request_upload": {
        const nodeIds = asStringArray(args.node_ids);
        const filename = asString(args.filename);
        const contentType = asString(args.content_type);
        const size = asNumber(args.size);
        if (!nodeIds || !filename || !contentType || size === undefined) {
          throw new ToolError(-32602, `${name} requires node_ids, filename, content_type, size`);
        }
        const r = await requestUpload(userId, {
          nodeIds,
          filename,
          contentType,
          size,
          caption: asString(args.caption),
        });
        return textContent({
          attachment_id: r.attachmentId,
          upload_url: r.uploadUrl,
          expires_at: r.expiresAt,
          next: `PUT the file bytes to upload_url with header "Content-Type: ${r.contentType}", then call vtx_attachment_confirm with attachment_id.`,
        });
      }
      case "vtx_attachment_confirm": {
        const att = await confirmAndExtract(userId, attachmentId!, asString(args.extracted_text));
        return textContent({ attachment: summarize(att) });
      }
      case "vtx_attachment_extract": {
        const att = await extractAttachment(userId, attachmentId!);
        return textContent({ attachment: summarize(att) });
      }
      case "vtx_attachment_set_text": {
        const text = asString(args.text);
        if (!text) throw new ToolError(-32602, "vtx_attachment_set_text requires text");
        const att = await setAttachmentText(userId, attachmentId!, text);
        return textContent({ attachment: summarize(att) });
      }
      case "vtx_attachment_get": {
        const att = await getAttachmentWithUrl(userId, attachmentId!);
        if (!att) throw new ToolError(-32602, `Attachment '${attachmentId}' not found.`);
        const { r2Key: _r2Key, ...rest } = att;
        return textContent(rest);
      }
      case "vtx_attachment_link": {
        const att = await linkAttachment(userId, attachmentId!, {
          add: asStringArray(args.add_node_ids),
          remove: asStringArray(args.remove_node_ids),
        });
        return textContent({ attachment: summarize(att) });
      }
      default: {
        const att = await deleteAttachment(userId, attachmentId!);
        if (!att) throw new ToolError(-32602, `Attachment '${attachmentId}' not found.`);
        return textContent(`Deleted attachment: ${att.filename} (${att.id})`);
      }
    }
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e instanceof R2NotConfiguredError) throw new ToolError(-32603, e.message);
    throw new ToolError(-32602, e instanceof Error ? e.message : `${name} failed`);
  }
};
