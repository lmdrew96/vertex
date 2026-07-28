# Vertex GUI Spec

Companion to `docs/VERTEX-SPEC.md`. Vertex currently has zero UI beyond the token
landing page (`app/page.tsx`) — this spec adds a real graph browser at
`app/[userId]/graph/`. Immediate driver: Nae is using Vertex as a study tool for
her Linguistics/SLA coursework (domain tag `domain:sla`, with `origin:literature`
vs `origin:nae` provenance on `claim` nodes), and needs to actually *see* the
graph, not just query it through Claude.

**Status:** Spec-only. No GUI code has been written yet.

---

## Constraints (do not deviate without checking in)

- Reuse `lib/nodes.ts`, `lib/edges.ts`, `lib/graph.ts` as-is. Do not duplicate
  Redis logic in the GUI layer — call these functions directly from Server
  Components / Route Handlers. The GUI does **not** go through the `/mcp`
  JSON-RPC endpoint.
- Next 16 (app router), React 19, no Tailwind currently installed — existing
  styling is hand-written CSS with vars in `app/globals.css` (ADHDesigns theme:
  Fraunces/Space Grotesk/Geist Mono, olive/teal/gold/purple/mint/green palette).
  Match that convention; don't introduce Tailwind for this feature alone.
- Auth model is unchanged: `userId` from the URL path param, trusted, no
  session validation — same as the MCP route.
- New dependency: `@xyflow/react` (React Flow) for the graph canvas. This is
  the only new runtime dependency this feature needs.

---

## Route structure

```
app/[userId]/graph/
  page.tsx              # Server Component — fetches initial node list, renders GraphShell
  GraphShell.tsx         # Client Component — owns selected-node state, layout
  Sidebar.tsx            # Client — search box, type filter, tag filter, node list
  GraphCanvas.tsx        # Client — React Flow wrapper
  DetailPanel.tsx        # Client — slide-in panel for selected node
  QuickCreate.tsx        # Client — new node / new edge forms
  actions.ts             # Server Actions — createNode, createEdge, archiveNode, deleteEdge
```

---

## Data flow

`page.tsx` is a Server Component. On load:

```ts
import { searchNodes } from "@/lib/nodes";

const initialNodes = await searchNodes(userId, { query: "", include_archived: false });
```

(`searchNodes` with an empty query string already returns all active nodes —
confirmed in `lib/nodes.ts`, no new function needed for the base list.)

Pass `initialNodes` into `GraphShell` as props. All subsequent interaction
(clicking a node, changing filters, creating nodes/edges) happens client-side
via Server Actions in `actions.ts`, which call straight into `lib/nodes.ts`,
`lib/edges.ts`, `lib/graph.ts` — no fetch-to-self, no JSON-RPC envelope.

**One new read helper is worth adding** to `lib/nodes.ts` (not a new file):

```ts
// Returns every distinct tag currently in use, for the Sidebar tag filter dropdown.
export const getAllTags = async (userId: string): Promise<string[]> => {
  const allIds = await redis.smembers(allNodesKey(userId)) as string[];
  const nodes = (await Promise.all(allIds.map(id => getNode(userId, id))))
    .filter((n): n is VertexNode => n !== null);
  return [...new Set(nodes.flatMap(n => n.tags))].sort();
};
```

Everything else needed already exists: `getNodeWithEdges` (in `lib/graph.ts`)
gives the DetailPanel its full in/out edge list in one call.

---

## Component behavior

### Sidebar
- Search input → debounced call to `searchNodes` Server Action
- Type filter: dropdown over `NODE_TYPES` (`concept` / `person` / `work` /
  `claim` / `question`)
- Tag filter: multi-select populated from `getAllTags`. Default view should
  **not** silently mix domains — if a `domain:*` tag is selected, only show
  nodes carrying it. Otherwise show everything (Vertexism + SLA + anything
  future) so the tool stays general-purpose.
- List item click → sets `selectedNodeId` in `GraphShell` state, which drives
  both `GraphCanvas` (recenter) and `DetailPanel` (open)

### GraphCanvas (React Flow)
- On `selectedNodeId` change, call `graphQuery(userId, { node_id, depth: 2 })`
  via Server Action, render result as React Flow nodes/edges
- **Do not render the entire graph at once by default.** Always centered on a
  root node at depth 2 (matches existing `vtx_graph_query` default). A
  "show more" control can bump depth to 3–4 per `VERTEX-SPEC.md` limits.
- Node color by `type`:
  | type | color var |
  |---|---|
  | concept | `--color-teal-deep` |
  | person | `--color-gold` |
  | work | `--color-mint` |
  | claim | `--color-olive` |
  | question | `--color-purple` |
- Edge style by `type` — visually distinguish disagreement from support:
  | type | treatment |
  |---|---|
  | `contradicts` | solid, `--color-gold`, thicker stroke |
  | `tension_with` | dashed, `--color-gold` |
  | `evidenced_by` | solid, `--color-mint` |
  | `instance_of` | solid, `--color-teal-deep`, arrowhead |
  | `connects_to` | solid, `--color-lavender`, thin |
- Clicking a node in the canvas sets `selectedNodeId` too (same state as
  Sidebar click) — canvas and sidebar stay in sync
- Clicking an edge shows its `evidence`/`notes` text in a small tooltip/popover
  (this is where the "why do these connect" payoff lives — don't bury it in
  the DetailPanel only)

### DetailPanel
- Slides in from the right on node selection
- Shows: name, type badge, full description, tags (as chips), `origin:*` tag
  visually distinct (e.g. `origin:nae` gets a small accent) if present
- Two edge lists: "Connects to" (outgoing) and "Connected from" (incoming),
  each edge row showing the other node's name + edge type + truncated
  evidence/notes, click-through to recenter graph on that node
- Archive button (calls `archiveNode` Server Action) — confirm before firing,
  this is a real state change

### QuickCreate
- Two modes, toggled by tab: "New Node" / "New Edge"
- New Node form: type (select), name, description (textarea), tags
  (comma-separated input, split on submit) → `createNode` Server Action
- New Edge form: from/to (both autocomplete against current node list, not
  free text — prevents typos creating dangling references), type (select),
  evidence (textarea, optional), notes (textarea, optional) →
  `createEdge` Server Action
- On success, both forms clear and the new node/edge becomes the selected
  node/graph center — immediate visual confirmation, no toast-and-forget

---

## Resolved decisions

1. **Orphan handling in the UI.** Dedicated orphans filter/section in the
   Sidebar (not just a dismissible banner) — lets Nae browse orphaned nodes
   directly, not just get warned about them.
2. **Cross-domain default view.** Default filter is `domain:sla` (matches this
   doc's stated driver), not all-domains-mixed. Nae can clear the tag filter
   to see everything, or pick a different `domain:*` tag.
3. **Mobile.** Simplified list-only fallback below a desktop breakpoint —
   GraphCanvas (React Flow) doesn't render on small viewports; Sidebar +
   DetailPanel-as-list still work.

---

## Out of scope for v1

- Editing existing nodes' type (only name/description/tags are mutable per
  `NodeUpdateInput` — changing type would orphan edge-type assumptions, not
  worth solving now)
- Bulk import (e.g. from ResearchJournal) — separate spec if/when that
  workflow gets built
- Graph layout persistence (React Flow will auto-layout each time; manual
  node dragging won't be saved between sessions in v1)
