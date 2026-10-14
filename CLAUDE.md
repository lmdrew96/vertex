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
- **Storage:** Upstash Redis via `@upstash/redis` (its own DB, named "Vertex"). Files go in the private Cloudflare R2 bucket `vertex`, reached through `aws4fetch` (SigV4 over fetch, edge/Workers-safe; no AWS SDK).
- **Auth:** email + password accounts, ported from Tangle (`lib/auth.ts`, `app/api/auth/route.ts` on the nodejs runtime). See "Accounts and tokens" below.
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
  page.tsx                  # Landing page: sign up/in, MCP URL, rotate
  auth-panel.tsx            # Sign-up/sign-in form (with claim-existing-URL field)
  api/auth/route.ts         # me / signup / login / logout / rotate
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
  meetings.ts               # logMeeting(): vtx_meeting_log, reused by the web UI's "Log a meeting"
  brief.ts                  # brief() + whoKnows(): vtx_brief, vtx_who_knows
  auth.ts                   # PBKDF2 accounts, sessions, rate limits, token → graph resolution
  r2.ts                     # Presigned PUT/GET, HEAD, DELETE against the private R2 bucket
  attachments.ts            # Attachment upload flow, link/delete, listing
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

### Accounts and tokens

The `[userId]` path segment is a **token**, not the graph namespace. Always run it through `resolveGraphId(token)` first (the MCP route, the graph page, and every server action do this):
- An owned token (`vertex:tokenowner:{token}` → `{ email, graphId }`) resolves to the account's `graphId`.
- A retired token (`vertex:tokenretired:{token}`, set on rotation) resolves to null, which is a 401.
- A token no account has ever claimed resolves to itself, the same as before accounts existed.

`graphId` is the account's first token and never changes, so graph keys never move. Signup can claim an existing token (the URL Claude is already connected to). Rotation mints a new token, retires the old one, and keeps `graphId`. Other keys: `vertex:account:{email}`, `vertex:session:{sid}` (HttpOnly cookie `vertex_session`, 30 days), `vertex:rl:*`. PBKDF2 uses 100k iterations, stored per record and within Workers' Web Crypto limit. No native crypto deps.

### Orphans

When an edge is created, both endpoints leave the orphan set and get `connectedAt`. When an edge is deleted, an endpoint with no remaining edges goes back in. Archiving is lazy: `vtx_orphans_list` and `vtx_graph_query` auto-archive orphans older than 7 days. `vtx_node_create` responses warn about this and suggest an edge.

### IDs

Nodes get slugs (`"Art Trembanis"` → `art-trembanis`, then `-2`, `-3` on collision). Edges get `crypto.randomUUID()`.

### Tools

All tools are prefixed `vtx_`. Current tools: `vtx_node_create`, `vtx_node_get`, `vtx_node_update`, `vtx_node_archive`, `vtx_node_search`, `vtx_orphans_list`, `vtx_edge_create`, `vtx_edge_delete`, `vtx_graph_query`, `vtx_graph_render`, `vtx_meeting_log`, `vtx_brief`, `vtx_who_knows`, `vtx_attachment_request_upload`, `vtx_attachment_confirm`, `vtx_attachment_get`, `vtx_attachment_link`, `vtx_attachment_delete`.

`vtx_node_search` matches name > description > meeting notes > attachment text and reports `matchedIn`. The UI's `searchNodes` wraps the same logic and returns plain nodes.

`vtx_who_knows` ranks `can_help_with` > `involved_in` > `mentioned`. A mention is attending a meeting about a matched topic, meeting notes that contain the query, or the person's own profile (description, role, affiliation, howWeMet).

### Meeting log matching (`lib/meetings.ts`)

`logMeeting` resolves every attendee, group, and topic before it writes anything. If any of them needs a choice, it returns `needs_choice` and creates nothing. Rules, in order:
1. An existing node ID wins. A wrong type is an error. An archived node gets reactivated.
2. Exactly one active node with the same name (case-insensitive) wins. Two or more is `ambiguous`.
3. A name listed in `confirmNew` is created as a new node.
4. An archived node with the same name gives `archived`.
5. People only: a shared word or containment ("Trembanis" ~ "Art Trembanis") gives `similar`.
6. Otherwise a new node is created.

A meeting needs at least one attendee or a group, so it can't be born an orphan.

### Attachments (`lib/attachments.ts`)

Files hang on one or more nodes and are never nodes themselves. Keys: `vertex:att:{graphId}:{attId}` (record), `vertex:atts:node:{graphId}:{nodeId}` and `vertex:atts:all:{graphId}` (SETs), and `vertex:attupload:{graphId}:{attId}` (a pending upload, 1-hour TTL). Object key: `vertex/{graphId}/{attId}/{safeFilename}`.

The flow:
1. `request_upload` validates the type (jpeg/png/webp/pdf/docx/txt/md; HEIC rejected) and size (≤10 MB) and checks the nodes exist. It returns a 15-minute presigned PUT with Content-Type signed in.
2. The client PUTs the bytes.
3. `confirm` HEAD-checks the real type and size (a mismatch is deleted) and writes the record. Passed `extracted_text` is saved as `"provided"`; otherwise the record stays `"pending"` until the extraction patch.

Delete removes the R2 object first, then the record. Archiving a node leaves its files alone. Records never store or return a public URL; every read goes through a 1-hour presigned GET.

---

## Environment variables

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
R2_ACCOUNT_ID=          # Cloudflare account ID
R2_ACCESS_KEY_ID=       # R2 API token scoped to the `vertex` bucket (Object Read & Write)
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=vertex
```

Without the R2 vars, the attachment tools return a clear "not set up" error and everything else keeps working.

Set these in `.env.local` for local dev and in Vercel project settings for production.

---

## Deployment

- Vercel project: `vertex.adhdesigns.dev`
- MCP endpoint: `/{userId}/mcp`
- No database migrations. Redis is schemaless.
