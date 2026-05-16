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
