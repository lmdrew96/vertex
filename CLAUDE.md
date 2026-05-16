# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What this is

Vertex is an MCP server for Nae's Vertexism knowledge graph — a graph-structured idea database where nodes are things (concepts, people, works, claims, questions) and edges are relationships between them. It is **Tangle's sibling** and must be built using the exact same architecture and patterns. When in doubt, look at `/Users/nae/Desktop/DevelopmentProjects/Tangle`.

**Status:** Spec-only. No application code has been written yet. The spec lives in `docs/VERTEX-SPEC.md`.

---

## Stack

- **Language:** TypeScript, strict mode
- **Framework:** Next.js (app router)
- **Runtime:** Vercel edge (`export const runtime = "edge"` on the route)
- **Storage:** Upstash Redis via `@upstash/redis`
- **Auth:** Clerk user ID passed as URL path param — no session validation, the userId is trusted
- **MCP protocol:** Hand-rolled JSON-RPC 2.0 — **no `@modelcontextprotocol/sdk`**
- **Tests:** Vitest

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

## Project structure (mirror Tangle exactly)

```
app/
  [userId]/mcp/route.ts   # POST + OPTIONS handler — JSON-RPC dispatcher
lib/
  types.ts                # Node, Edge, NodeType, EdgeType interfaces + enums
  redis.ts                # Upstash Redis client singleton
  keys.ts                 # All Redis key constructors (namespaced by userId)
  mcp.ts                  # JSON-RPC envelope helpers (ok/err), TOOLS array, dispatchTool()
  nodes.ts                # Node CRUD + search business logic
  edges.ts                # Edge CRUD + adjacency index maintenance
  graph.ts                # BFS traversal (vtx_graph_query) + Mermaid render (vtx_graph_render)
  *.test.ts               # Unit tests, picked up by vitest from lib/**/*.test.ts
```

---

## Architecture

### MCP protocol layer

The route at `app/[userId]/mcp/route.ts` handles `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` methods. It delegates tool execution to `dispatchTool()` in `lib/mcp.ts`. Identity is read from the `X-Claude-Identity` request header (falls back to `?identity=` query param).

`lib/mcp.ts` exports:
- `ok(id, result)` / `err(id, code, message)` — JSON-RPC response helpers with CORS headers
- `TOOLS` — the full `inputSchema`-typed tool definitions array
- `SERVER_INFO` — name/version/protocolVersion
- `ToolError` — throw from any tool function to return a structured error
- `dispatchTool(name, args, ctx)` — switch statement routing tool calls to business logic

### Redis key structure

All keys are namespaced `vertex:{type}:{userId}:{id}`. The key helpers in `lib/keys.ts` must be the single source of truth — never inline key strings. Key types:
- `vertex:node:{userId}:{nodeId}` → JSON blob (Node)
- `vertex:edge:{userId}:{edgeId}` → JSON blob (Edge)
- `vertex:nodes:all:{userId}` → Redis SET of nodeIds
- `vertex:edges:all:{userId}` → Redis SET of edgeIds
- `vertex:adj:from:{userId}:{nodeId}` → Redis SET of edgeIds where `edge.from === nodeId`
- `vertex:adj:to:{userId}:{nodeId}` → Redis SET of edgeIds where `edge.to === nodeId`
- `vertex:orphans:{userId}` → Redis SET of nodeIds with zero edges

### Adjacency indices

Unlike Tangle (which uses sorted sets), Vertex adjacency indices are plain Redis SETs. Maintain them on every `vtx_edge_create` and `vtx_edge_delete` — update `vertex:adj:from`, `vertex:adj:to`, and `vertex:orphans` atomically (use `Promise.all`).

### Orphan tracking + counter-discipline

When an edge is created: remove both `from` and `to` from the orphans set; set `connectedAt` on each node if not already set. When an edge is deleted: check if either endpoint now has zero total edges — if so, add back to orphans and null `connectedAt`.

Counter-discipline is lazy (no cron): on every `vtx_orphans_list` and `vtx_graph_query` call, auto-archive any orphan node where `createdAt` is >7 days ago. Include `"Archived orphaned node: {name} (created {N} days ago, never connected)"` in the response.

### BFS traversal

`vtx_graph_query` does BFS from a starting node to `depth` hops (1–4). At each hop, fetch all edgeIds from `vertex:adj:from` and `vertex:adj:to` for each queued nodeId, resolve Edge + the other endpoint, and add to visited sets. Apply `edge_types` filter before enqueuing. Return deduplicated nodes + edges.

`vtx_graph_render` calls `vtx_graph_query` internally and formats the result as a `graph LR` Mermaid string with node labels `"Name\n(type)"` and edge labels from the edge type.

### ID generation

- **Nodes:** slug generated from name (`"Sacred Edges"` → `"sacred-edges"`). If slug exists, append `-2`, `-3`, etc. See `generateSlug` / `uniqueSlug` in the spec.
- **Edges:** UUID (`crypto.randomUUID()` — available in edge runtime).

### Tool prefix

All tools are prefixed `vtx_`. There are 9 tools: `vtx_node_create`, `vtx_node_get`, `vtx_node_update`, `vtx_node_archive`, `vtx_node_search`, `vtx_orphans_list`, `vtx_edge_create`, `vtx_edge_delete`, `vtx_graph_query`, `vtx_graph_render`.

---

## Environment variables

```
UPSTASH_REDIS_REST_URL=     # Upstash Redis REST URL
UPSTASH_REDIS_REST_TOKEN=   # Upstash Redis REST token
```

The Upstash instance is already provisioned. Set these in `.env.local` for local dev and in Vercel project settings for production. Use these names in `lib/redis.ts` (unlike Tangle, which uses Vercel's auto-injected `KV_REST_API_*` names).

---

## Deployment

- Vercel project: `vertex.adhdesigns.dev`
- Single POST endpoint: `/{userId}/mcp`
- No database migrations — Redis is schemaless