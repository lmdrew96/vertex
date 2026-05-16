# VERTEX-SPEC.md
## MCP server for Nae's Vertexism knowledge graph

---

## What this is

Vertex is a graph-structured idea database. Nodes are things (concepts, people, books, claims, questions). Edges are how they relate. The whole point is that **meaning lives in connections** — so the tool is built around querying, traversing, and rendering the web of relationships, not just storing facts.

It's Tangle's sibling. Build it exactly the same way.

---

## Stack

Same pattern as Tangle — no new infrastructure:

- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Storage**: Upstash Redis (one Redis instance, namespaced by userId)
- **Auth**: Clerk user ID in URL path
- **Transport**: Stateless streamable HTTP, single POST endpoint at `/mcp`
- **Deploy**: Vercel
- **URL**: `vertex.adhdesigns.dev/{userId}/mcp`

---

## Data model

### Node

```typescript
interface Node {
  id: string           // slug generated from name: "Sacred Edges" → "sacred-edges"
  type: NodeType
  name: string
  description: string
  tags: string[]
  status: 'active' | 'archived'
  createdAt: string    // ISO timestamp
  updatedAt: string
  connectedAt?: string // ISO timestamp — set when the first edge is created for this node
}

type NodeType = 'concept' | 'person' | 'work' | 'claim' | 'question'
```

### Edge

```typescript
interface Edge {
  id: string           // uuid
  from: string         // node id
  to: string           // node id
  type: EdgeType
  evidence?: string    // optional: quote, citation, or brief rationale
  notes?: string       // optional: free text
  createdAt: string
}

type EdgeType =
  | 'connects_to'    // general relationship
  | 'tension_with'   // productive friction, contrast, or unresolved opposition
  | 'instance_of'    // specific → general (e.g. Whitman is an instance_of proto-Vertexist)
  | 'contradicts'    // direct logical opposition
  | 'evidenced_by'   // a claim supported by a work, person, or source
```

---

## Redis key structure

```
vertex:node:{userId}:{nodeId}         → JSON blob (Node)
vertex:edge:{userId}:{edgeId}         → JSON blob (Edge)
vertex:nodes:all:{userId}             → Redis SET of nodeIds (all active + archived)
vertex:edges:all:{userId}             → Redis SET of edgeIds
vertex:adj:from:{userId}:{nodeId}     → Redis SET of edgeIds where edge.from === nodeId
vertex:adj:to:{userId}:{nodeId}       → Redis SET of edgeIds where edge.to === nodeId
vertex:orphans:{userId}               → Redis SET of nodeIds with no edges (maintained on edge create/delete)
```

**Orphan tracking:** When an edge is created, remove both `from` and `to` node IDs from `vertex:orphans:{userId}`. When an edge is deleted, check if either endpoint now has zero edges — if so, add back to orphans set and set `connectedAt` to null on the node.

---

## Tool definitions

Tool prefix: `vtx_`

---

### `vtx_node_create`

Creates a new node. Generates a slug ID from the name (lowercase, hyphens, no special chars). If slug already exists, appends `-2`, `-3`, etc.

**Input:**
```typescript
{
  type: NodeType,
  name: string,            // e.g. "Sacred edges"
  description: string,     // what this node is — 1-3 sentences
  tags?: string[]          // optional topic tags, e.g. ["vertexism", "edge-states"]
}
```

**Behavior:**
- Adds node to `vertex:nodes:all:{userId}`
- Adds node ID to `vertex:orphans:{userId}` (starts disconnected)
- Returns the created Node

**Output:** The created `Node` object

---

### `vtx_node_get`

Fetch a single node plus all its edges (both directions).

**Input:**
```typescript
{
  id: string    // node id or name (fuzzy match on name if no exact id match)
}
```

**Output:**
```typescript
{
  node: Node,
  edges: {
    outgoing: Array<{ edge: Edge, target: Node }>,
    incoming: Array<{ edge: Edge, source: Node }>
  }
}
```

---

### `vtx_node_update`

Update name, description, or tags on an existing node.

**Input:**
```typescript
{
  id: string,
  name?: string,
  description?: string,
  tags?: string[]
}
```

**Output:** Updated `Node`

---

### `vtx_node_archive`

Soft-delete a node. Sets `status: 'archived'`. Does not delete edges — archived nodes are excluded from graph_query and graph_render by default but edges remain for data integrity.

**Input:** `{ id: string }`

**Output:** Confirmation string

---

### `vtx_node_search`

Full-text search across node names and descriptions. Case-insensitive substring match (no embeddings in v1 — simple SCAN + filter).

**Input:**
```typescript
{
  query: string,
  type?: NodeType,          // optional filter by node type
  include_archived?: boolean // default false
}
```

**Output:** `Node[]` sorted by relevance (name match > description match)

---

### `vtx_orphans_list`

Returns nodes with no edges. These are candidates for archiving per the counter-discipline rule.

**Input:** none

**Output:**
```typescript
Array<{
  node: Node,
  createdAt: string,
  daysOrphaned: number    // days since createdAt with no connections
}>
```

Sorted by `daysOrphaned` descending (most neglected first). Coru will surface these proactively during Vertexism sessions.

---

### `vtx_edge_create`

Connect two existing nodes.

**Input:**
```typescript
{
  from: string,        // node id
  to: string,          // node id
  type: EdgeType,
  evidence?: string,   // quote, citation, or rationale
  notes?: string
}
```

**Behavior:**
- Validates both `from` and `to` exist (return error if not)
- Adds edge to `vertex:adj:from` and `vertex:adj:to` indices
- Removes both nodes from `vertex:orphans:{userId}`
- Sets `connectedAt` on both nodes if not already set

**Output:** The created `Edge` + both connected `Node` objects

---

### `vtx_edge_delete`

Remove an edge between two nodes.

**Input:** `{ id: string }`

**Behavior:**
- Removes from adjacency indices
- If either endpoint now has zero total edges, adds it back to orphans set

**Output:** Confirmation string

---

### `vtx_graph_query`

BFS traversal from a starting node outward to `depth` hops. Returns the subgraph (all nodes + edges reachable within that depth).

**Input:**
```typescript
{
  node_id: string,
  depth: number,          // 1-4, default 2
  edge_types?: EdgeType[] // optional filter — only traverse these edge types
}
```

**Algorithm:**
1. Resolve starting node (fuzzy match name if needed)
2. BFS queue starting at `node_id`
3. At each hop: fetch all edgeIds from `vertex:adj:from` and `vertex:adj:to` for each queued nodeId
4. For each edge: fetch Edge, resolve the other endpoint, add to visited set if not already seen
5. If `edge_types` filter is provided, only traverse edges of those types
6. Stop at depth N
7. Deduplicate nodes and edges

**Output:**
```typescript
{
  root: Node,
  nodes: Node[],
  edges: Edge[],
  depth: number,
  nodeCount: number,
  edgeCount: number
}
```

---

### `vtx_graph_render`

Runs `vtx_graph_query` internally, then formats the result as a Mermaid diagram string. Useful for pasting into Folio or a Substack draft.

**Input:**
```typescript
{
  node_id: string,
  depth?: number,          // default 2
  edge_types?: EdgeType[]
}
```

**Output:** A Mermaid diagram string in `graph LR` format:

```
graph LR
  sacred-edges["Sacred edges\n(concept)"]
  whitman["Whitman\n(person)"]
  song-of-myself["Song of Myself\n(work)"]
  whitman -->|"instance_of"| sacred-edges
  song-of-myself -->|"evidenced_by"| whitman
```

Node labels include name + type in parentheses. Edge labels use the edge type. Archived nodes are excluded.

---

## Counter-discipline logic

> Every node must form at least one connection within 7 days of creation or it gets archived.

This is enforced **lazily** — not by a cron, but by checking on every `vtx_orphans_list` call and every `vtx_graph_query` call:

- If a node is in the orphans set AND `createdAt` is more than 7 days ago → auto-archive it and include a note in the response: `"Archived orphaned node: {name} (created {N} days ago, never connected)"`
- Coru should call `vtx_orphans_list` at the start of any Vertexism session to surface nodes approaching the deadline

This is philosophically load-bearing: an isolated node has no meaning in Vertexism. The tool enforces its own framework.

---

## ID generation

```typescript
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

async function uniqueSlug(userId: string, name: string, redis: Redis): Promise<string> {
  const base = generateSlug(name)
  const exists = await redis.get(`vertex:node:${userId}:${base}`)
  if (!exists) return base
  let n = 2
  while (await redis.get(`vertex:node:${userId}:${base}-${n}`)) n++
  return `${base}-${n}`
}
```

---

## Error handling

All tools should return actionable errors:

- Node not found: `"Node '{id}' not found. Use vtx_node_search to find the right ID."`
- Invalid edge: `"Cannot create edge: node '{id}' does not exist. Create it first with vtx_node_create."`
- Depth out of range: `"Depth must be between 1 and 4. Deeper traversals are expensive — query a closer neighborhood first."`
- Self-loop: `"Cannot create an edge from a node to itself."`

---

## Deployment

- Deploy to Vercel as `vertex.adhdesigns.dev`
- Single `POST /mcp` endpoint, stateless
- Clerk user ID passed as path param: `/{userId}/mcp`
- Upstash Redis connection via `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` env vars
- No database migrations — Redis is schemaless, keys are created on first write

---

## Seeding

After deploy, Coru will seed the initial Vertexism graph via MCP tools. No seed script needed. First session will create:
- The four edge states as concept nodes
- Whitman as a person node
- Song of Myself as a work node
- Core claims from the essay outline
- Connections between them

---

## v1 scope (build this)

- All tools above
- Redis storage with adjacency indices
- Orphan tracking + counter-discipline enforcement
- Mermaid render output
- Lazy orphan auto-archive

## Out of scope for v1

- Semantic / embedding-based search (v1 is substring only)
- Graph visualization UI (Mermaid export is the UI)
- Public/shared graphs
- Cross-user collaboration
- Import from Research Journal (future — would link article nodes to claim/work nodes)
