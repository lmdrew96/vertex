# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What this is

Vertex is Nae's **people graph**: an MCP server and web graph browser for her network (people, groups, meetings, and topics) and the edges between them: who belongs where, who introduced whom, what came up at which meeting. It is Tangle's sibling and follows Tangle's architecture (`/Users/nae/Desktop/DevelopmentProjects/Tangle`).

**Current spec:** `docs/VERTEX-NETWORK-SPEC.md` (Oct 14, 2026). Read it before planning work. It sets scope (meetings live in ControlledChaos, research lives in ThreadNotes, files are attachments, not nodes) and the build order. The old research-graph data was exported to `docs/vertex-export-2026-09-20.json` and wiped.

---

## Stack

- **Language:** TypeScript, strict mode
- **Framework:** Next.js (app router)
- **Runtime:** Vercel edge (`export const runtime = "edge"` on the MCP route and graph page). A Cloudflare Workers migration is pending as its own patch.
- **Storage:** Upstash Redis via `@upstash/redis` (its own DB, named "Vertex")
- **Auth:** none yet. The landing page generates a random token (`crypto.randomUUID()`, kept in localStorage) that serves as the `userId` path segment of the MCP URL. Account auth is a pending patch and must land before attachments.
- **MCP protocol:** Hand-rolled JSON-RPC 2.0. **No `@modelcontextprotocol/sdk`.**
- **Graph UI:** `@xyflow/react`
- **Tests:** Vitest with an in-memory Redis shim (see the top of each `lib/*.test.ts`)

---

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit (no output = clean)
npm run test         # vitest run (one-shot)
npm run test:watch   # vitest watch
```

---

## Project structure

```
app/
  page.tsx                  # Landing page: token generation + MCP URL
  [userId]/mcp/route.ts     # GET (SSE) + POST + OPTIONS: JSON-RPC dispatcher
  [userId]/graph/           # Graph browser: GraphShell, GraphCanvas, Sidebar, DetailPanel, QuickCreate
    actions.ts              # Server actions wrapping lib/ for the UI
lib/
  types.ts                  # NodeType/EdgeType, per-type fields, VertexNode discriminated union
  redis.ts                  # Upstash Redis client singleton
  keys.ts                   # All Redis key constructors (namespaced by userId)
  mcp.ts                    # ok/err helpers, TOOLS, SERVER_INFO, ToolError, dispatchTool()
  nodes.ts                  # Node CRUD, field validation, meeting naming, search, orphans
  edges.ts                  # Edge CRUD, from→to pair rules, adjacency index maintenance
  graph.ts                  # BFS traversal + Mermaid render + node-with-edges hydration
  *.test.ts                 # Unit tests
```

---

## Data model

### Node types (`lib/types.ts`)

| Type | Extra `fields` (optional unless noted) |
|---|---|
| `person` | `role`, `affiliation`, `email`, `howWeMet` |
| `group` | `kind` (council / club / office / class / program), `url` |
| `meeting` | `date` (YYYY-MM-DD, **required**), `ccEventId`, `notes` (markdown), `followUpTaskIds` |
| `topic` | none |

`VertexNode` is a discriminated union on `type`. `parseFields()` in `lib/nodes.ts` validates fields at runtime against the type. On update, fields merge, and `null` clears a key (a meeting's `date` can't be cleared). `description` is optional and defaults to `""`. Meeting names default to the date. `meetingName(date, context)` builds `"{date} · {group or first attendee}"`.

Meeting dates are local calendar dates stored as plain strings. Never convert them to or from UTC.

### Edge types and allowed pairs (`EDGE_RULES` in `lib/edges.ts`)

| Edge | From → To |
|---|---|
| `member_of` | person → group |
| `attended` | person → meeting |
| `held_by` | meeting → group |
| `about` | meeting → topic |
| `involved_in` | person/group → topic |
| `can_help_with` | person → topic |
| `introduced` | person → person |
| `connects_to` | any → any |

`createEdge` throws on a wrong pair. The error names the allowed pair and the edge types that would fit.

---

## Architecture

### Redis keys

All keys are namespaced `vertex:{type}:{userId}:{id}`. `lib/keys.ts` is the single source of truth. Never inline key strings.
- `vertex:node:{userId}:{nodeId}` → JSON Node
- `vertex:edge:{userId}:{edgeId}` → JSON Edge
- `vertex:nodes:all:{userId}` / `vertex:edges:all:{userId}` → SETs of IDs
- `vertex:adj:from:{userId}:{nodeId}` / `vertex:adj:to:{userId}:{nodeId}` → SETs of edgeIds
- `vertex:orphans:{userId}` → SET of nodeIds with zero edges

### Orphans

When an edge is created, both endpoints leave the orphan set and get `connectedAt`. When an edge is deleted, an endpoint with no remaining edges goes back in. Archiving is lazy: `vtx_orphans_list` and `vtx_graph_query` auto-archive orphans older than 7 days. `vtx_node_create` responses warn about this and suggest an edge.

### IDs

Nodes get slugs (`"Art Trembanis"` → `art-trembanis`, then `-2`, `-3` on collision). Edges get `crypto.randomUUID()`.

### Tools

All tools are prefixed `vtx_`. Current tools: `vtx_node_create`, `vtx_node_get`, `vtx_node_update`, `vtx_node_archive`, `vtx_node_search`, `vtx_orphans_list`, `vtx_edge_create`, `vtx_edge_delete`, `vtx_graph_query`, `vtx_graph_render`. Planned (see the spec): `vtx_meeting_log`, `vtx_brief`, `vtx_who_knows`, and the `vtx_attachment_*` tools.

---

## Environment variables

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Set these in `.env.local` for local dev and in Vercel project settings for production.

---

## Deployment

- Vercel project: `vertex.adhdesigns.dev`
- MCP endpoint: `/{userId}/mcp`
- No database migrations. Redis is schemaless.
