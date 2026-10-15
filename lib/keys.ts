// All Redis key constructors — single source of truth, never inline key strings.

export const nodeKey = (userId: string, nodeId: string) =>
  `vertex:node:${userId}:${nodeId}`;

export const edgeKey = (userId: string, edgeId: string) =>
  `vertex:edge:${userId}:${edgeId}`;

export const allNodesKey = (userId: string) =>
  `vertex:nodes:all:${userId}`;

export const allEdgesKey = (userId: string) =>
  `vertex:edges:all:${userId}`;

// Archived edges: out of the indexes above (so nothing traverses them) but kept for restore.
export const archivedEdgesKey = (userId: string) =>
  `vertex:edges:archived:${userId}`;

export const adjFromKey = (userId: string, nodeId: string) =>
  `vertex:adj:from:${userId}:${nodeId}`;

export const adjToKey = (userId: string, nodeId: string) =>
  `vertex:adj:to:${userId}:${nodeId}`;

export const orphansKey = (userId: string) =>
  `vertex:orphans:${userId}`;

// ── Accounts (web auth + token → graph indirection) ──────────────────────────

export const accountKey = (email: string) =>
  `vertex:account:${email}`;

export const sessionKey = (sid: string) =>
  `vertex:session:${sid}`;

// token → { email, graphId }. The graph namespace never moves when a token rotates.
export const tokenOwnerKey = (token: string) =>
  `vertex:tokenowner:${token}`;

// Set on a token rotated out of an account, so it 401s instead of reading as an empty graph.
export const retiredTokenKey = (token: string) =>
  `vertex:tokenretired:${token}`;

export const rateKey = (scope: string, id: string) =>
  `vertex:rl:${scope}:${id}`;

// ── Attachments (files hang on nodes; never nodes themselves) ────────────────

export const attKey = (userId: string, attId: string) =>
  `vertex:att:${userId}:${attId}`;

export const nodeAttsKey = (userId: string, nodeId: string) =>
  `vertex:atts:node:${userId}:${nodeId}`;

export const allAttsKey = (userId: string) =>
  `vertex:atts:all:${userId}`;

// Upload requested but not yet confirmed. Expires, so abandoned uploads never show up on a node.
export const pendingUploadKey = (userId: string, attId: string) =>
  `vertex:attupload:${userId}:${attId}`;
