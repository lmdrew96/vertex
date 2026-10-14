# Vertex — Network Spec (people graph + attachments)

*Spec by Coru with Nae, Oct 14, 2026. Builder: Cody. Supersedes the Oct 6 "retire Vertex into ThreadNotes" decision.*

## Why Vertex is back

Nae's network at UD is growing: people, groups, and meetings across different parts of her life and career. She needs one place that keeps them organized alongside her meetings and topic notes.

This fixes why Vertex kept dying. The old graph was mostly nodes Claude wrote, and Nae wasn't drawn to it. A personal network is all real data she owns, and its value is in the **edges**: who introduced whom, who belongs to what, what came up where. That's Vertexism in plain form.

## Decisions (settled with Nae, Oct 14)

1. **Vertex = Nae's people graph.** Research (ideas, sources, hypotheses) stays in ThreadNotes. The ThreadNotes "Connections" work goes on as before; it just isn't "Vertex" any more.
2. **Vertex owns the network.** Personal Context keeps only close personal relationships (partner, close friends, family). UD contacts, groups, and professional relationships live in Vertex.
3. **Meetings stay in ControlledChaos.** Vertex meeting nodes *link to* ControlledChaos events and tasks by ID. Never copy calendar data into Vertex.
4. **Files are attachments, not nodes.** A file hangs on one or more nodes (meeting, person, group, topic). Files never appear as bubbles in the graph.
5. **Every file's text gets extracted and saved**, so files are searchable and feed the brief. Without that, an upload is dead weight.

## Design rule: logging has to pay off right away

LibraLex lesson: if logging is a chore and nothing comes back right away, the app dies. So:

- **Input stays cheap.** One call logs a whole meeting (`vtx_meeting_log`). Nae talks to Coru after a meeting, and Coru files it.
- **Payoff comes first.** The brief (`vtx_brief`) is the reason to open Vertex. Build it in the first wave, not last.

---

## 1. Data model

The graph is **empty** right now (checked Oct 14), so the node and edge types can be replaced outright with no migration.

### Node types

Replace `concept | person | work | claim | question` with:

| Type | What it is | Extra fields (all optional) |
|---|---|---|
| `person` | Someone Nae knows | `role` (e.g. "AAP Director"), `affiliation`, `email`, `howWeMet` |
| `group` | An org, council, team, class, or program | `kind` (council / club / office / class / program), `url` |
| `meeting` | One time Nae met with people | `date` (ISO, required for meetings), `ccEventId`, `notes` (markdown), `followUpTaskIds` (ControlledChaos task IDs) |
| `topic` | A subject that runs across people and meetings | (none beyond the base fields) |

Every node keeps the base fields: `id, type, name, description, tags, status, createdAt, updatedAt, connectedAt`.

Store the extra fields in an optional `fields` object on `VertexNode`, typed per node type with a discriminated union, so `lib/types.ts` stays strict.

**Meeting names:** auto-generate when none is given: `"{date} · {group or first attendee}"`, e.g. `"2026-10-14 · PSAC"`. Slug rules still apply.

### Edge types

Replace the research edge types with:

| Edge | From → To | Meaning |
|---|---|---|
| `member_of` | person → group | Belongs to, works in, or sits on |
| `attended` | person → meeting | Was at this meeting (Nae herself is implied, not a node) |
| `held_by` | meeting → group | The meeting was a group's meeting |
| `about` | meeting → topic | The meeting covered this topic |
| `involved_in` | person/group → topic | Works on or cares about this topic |
| `can_help_with` | person → topic | A resource for this topic (powers "who do I know who…") |
| `introduced` | person → person | A introduced Nae to B |
| `connects_to` | any → any | Catch-all; `notes` says how |

Keep `evidence` and `notes` on edges. Validate from → to pairs in `lib/edges.ts`. A wrong pair is a `ToolError` that names the allowed pairs.

### Orphan rule

Keep the 7-day orphan auto-archive. It fits Vertexism, and normal capture always creates edges: a person logged in a meeting gets `attended`. **Watch for:** `vtx_node_create` for a lone person (say, someone met in a hallway) will archive in 7 days unless they get an edge. That's fine. The tool response should say so and suggest an edge.

---

## 2. MCP tools

### Keep (updated for the new types)
`vtx_node_create`, `vtx_node_get`, `vtx_node_update`, `vtx_node_archive`, `vtx_node_search`, `vtx_orphans_list`, `vtx_edge_create`, `vtx_edge_delete`, `vtx_graph_query`, `vtx_graph_render`. The type enums and descriptions change. `vtx_node_get` also returns the node's attachments (metadata only, plus a short `textPreview`).

### New: `vtx_meeting_log` (the input-cutter)
Logs a whole meeting in one call.

```
input:
  date            string (YYYY-MM-DD), required
  name            string, optional (auto-generated if missing)
  attendees       string[]  names or node IDs; unknown names create person nodes
  group           string, optional  name or ID; unknown creates a group node
  topics          string[]  names or IDs; unknown creates topic nodes
  notes           string (markdown), optional
  cc_event_id     string, optional
  follow_up_task_ids string[], optional (ControlledChaos task IDs Coru already created)
output: the meeting node, every node created vs. matched, every edge created
```

**Matching:** name match is case-insensitive, against active nodes of the right type. If more than one node matches a name, **don't guess**. Return a `needs_choice` result listing the candidates and create nothing.

**Follow-ups** are ControlledChaos tasks, created by Coru through the CC MCP (each with a soft date, per Nae's rule). Vertex only stores their IDs.

### New: `vtx_brief` (the payoff)
```
input:  node (name or ID) — usually a person or group; also works for a topic or meeting
        limit_meetings  number, default 5
output:
  node + fields
  recentMeetings   last N meetings linked to it: date, name, notes excerpt, attachment previews
  people           connected people with role/affiliation and how they connect
  topics           topics linked through the node's meetings and edges
  openFollowUps    followUpTaskIds from those meetings (Coru checks status in ControlledChaos)
  lastContact      date of the most recent meeting
```
Coru turns this into: *"Meeting Trembanis tomorrow. Last time (Oct 14): the mentorship pilot. Open follow-up: send the alum survey idea."* Coru pulls upcoming meetings from ControlledChaos and calls `vtx_brief` for each attendee.

### New: `vtx_who_knows`
```
input:  query (a topic or free text, e.g. "public service")
output: people ranked by: can_help_with edge > involved_in edge > mentioned in meeting notes/attachment text
        each with the path that links them (edge or meeting) so Nae sees *why*
```

### Search upgrade
`vtx_node_search` also matches meeting `notes` and attachment `extractedText`. Rank: name > description > notes > attachment text. Results say where the match was found.

### New: attachment tools (see section 3)
`vtx_attachment_request_upload`, `vtx_attachment_confirm`, `vtx_attachment_get`, `vtx_attachment_link`, `vtx_attachment_delete`.

---

## 3. Attachments

### What's accepted
- Images: `image/jpeg`, `image/png`, `image/webp`. **HEIC (iPhone default):** convert to JPEG in the browser before upload in the web UI. Through MCP, Coru converts before uploading. The server rejects HEIC with a clear error.
- Documents: `application/pdf`, `.docx`, `text/plain`, `text/markdown`.
- Max size: 10 MB (same as ChaosPatch's `MAX_UPLOAD_BYTES`).

### Storage
- **Cloudflare R2**, private bucket. Copy ChaosPatch's `lib/r2.ts` pattern: presigned PUT for upload, presigned GET for every read, and no public access.
- Object key: `vertex/{userId}/{attachmentId}/{safeFilename}`.
- Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. New bucket or a `vertex/` prefix in an existing one: **Cody's call; state the choice in the PR.**
- **Runtime catch:** the MCP route runs on Vercel **edge**, and `@aws-sdk/client-s3` needs Node. Either run the attachment routes with `runtime = "nodejs"`, or use `aws4fetch` (edge-safe SigV4). If the Cloudflare Workers migration patch lands first, use a native R2 binding instead. Don't block on the migration.

### Record (Redis)
```
vertex:att:{userId}:{attId}            → JSON Attachment
vertex:atts:node:{userId}:{nodeId}     → SET of attIds on that node
vertex:atts:all:{userId}               → SET of all attIds
```
Add these to `lib/keys.ts`, never inline.

```ts
interface Attachment {
  id: string;                 // uuid
  nodeIds: string[];          // ≥1; a file can hang on several nodes
  filename: string;
  contentType: string;
  size: number;
  r2Key: string;
  caption?: string;
  extractedText?: string;
  extractStatus: "pending" | "done" | "failed" | "provided";
  extractError?: string;
  createdAt: string;
}
```

### Upload flow (MCP)
Copies ChaosPatch's `cp_request_image_upload` / `cp_confirm_image_upload` pattern.
1. `vtx_attachment_request_upload { node_ids, filename, content_type, size, caption? }` → `{ attachment_id, upload_url, expires_at }`. Validates the type and size, and checks that every node exists.
2. The client PUTs the bytes to `upload_url`.
3. `vtx_attachment_confirm { attachment_id, extracted_text? }` → HEAD-checks the object, then:
   - If `extracted_text` is passed, save it with `extractStatus: "provided"`. **This is the cheap path:** Coru already read the file in chat, so there's no server-side AI call.
   - Otherwise, run server extraction (below).

Other tools:
- `vtx_attachment_get { attachment_id }` → metadata, full `extractedText`, and a short-lived signed download URL.
- `vtx_attachment_link { attachment_id, add_node_ids?, remove_node_ids? }`. At least one node must remain.
- `vtx_attachment_delete { attachment_id }` → deletes the R2 object, then the record and its index entries.

When a node is **archived**, its attachments stay. When a file's **last** node is deleted, delete the file too.

### Server-side text extraction (web uploads, or MCP uploads with no text)
- PDF: `unpdf` (works on edge/Workers). If the PDF has no text layer (a scan), fall back to the vision call.
- DOCX: `mammoth` (Node runtime) or a light unzip + XML strip.
- TXT/MD: as-is.
- Images: one vision call to **Claude Haiku 5.5**. Use a single model-config constant, per Nae's one-constant-per-app rule. Prompt: transcribe all text exactly (handwriting included), then add one line describing any non-text content. No summarizing.
- Truncate stored text at ~50k chars. On failure, set `extractStatus: "failed"` with `extractError`. The upload still succeeds, and the UI offers "retry".

---

## 4. Web UI (`app/[userId]/graph`)

- **Type colors + filter chips** in the Sidebar for person / group / meeting / topic. Use ADHDesigns tokens; meeting nodes can be smaller.
- **DetailPanel:**
  - Person: role, affiliation, how-we-met, **meeting timeline** (newest first), connected groups and topics.
  - Meeting: date, attendees, group, topics, notes (markdown render), linked ControlledChaos event ID shown as a small chip.
  - **Attachments section on every node:** drop zone + "add file" button, thumbnails for images, file icon + name for docs, and an extract-status badge. Clicking opens the signed URL. Each file has a "text" toggle that shows the extracted text.
- **QuickCreate:** add "Log a meeting" (date, attendees, group, topics, notes). It calls the same logic as `vtx_meeting_log`.

---

## 5. Suggested build order

1. **Network model** (types, fields, edge validation). Unblocks everything.
2. **`vtx_meeting_log`** + **`vtx_brief`** + **`vtx_who_knows`.** Nae can start using Vertex through Coru at this point, before any UI work.
3. **Account auth** (existing patch c8d6339b). **Do this before attachments:** meeting notes and files about real people shouldn't sit behind an MCP URL token alone.
4. **Attachment storage + MCP upload flow.**
5. **Text extraction.**
6. **Web UI** (DetailPanel, attachments, log-a-meeting).
7. Existing **edge-first capture** + **onboarding** patches, updated to the new edge types.

Cloudflare Workers migration: independent. If it lands before step 4, use R2 bindings.

## Out of scope for now
- Syncing contacts from phone or Gmail
- Auto-creating meetings from every ControlledChaos event (Coru links them on request)
- Sharing the graph with anyone
- Reminders ("you haven't talked to X in 30 days"). Maybe later, once there's real data.
