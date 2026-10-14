// All Redis key constructors — single source of truth, never inline key strings.

export const nodeKey = (userId: string, nodeId: string) =>
  `vertex:node:${userId}:${nodeId}`;

export const edgeKey = (userId: string, edgeId: string) =>
  `vertex:edge:${userId}:${edgeId}`;

export const allNodesKey = (userId: string) =>
  `vertex:nodes:all:${userId}`;

export const allEdgesKey = (userId: string) =>
  `vertex:edges:all:${userId}`;

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
