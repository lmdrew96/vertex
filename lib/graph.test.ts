import { beforeEach, describe, expect, it, vi } from "vitest";

const { kv, sets, fakeRedis } = vi.hoisted(() => {
  const kv = new Map<string, unknown>();
  const sets = new Map<string, Set<string>>();

  const setFor = (key: string): Set<string> => {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  };

  const fakeRedis = {
    get: async (key: string) => kv.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      kv.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      const existed = kv.delete(key);
      return existed ? 1 : 0;
    },
    sadd: async (key: string, ...members: string[]) => {
      const s = setFor(key);
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) { s.add(m); added++; }
      }
      return added;
    },
    srem: async (key: string, ...members: string[]) => {
      const s = sets.get(key);
      if (!s) return 0;
      let removed = 0;
      for (const m of members) {
        if (s.delete(m)) removed++;
      }
      return removed;
    },
    smembers: async (key: string) => {
      return [...(sets.get(key) ?? [])];
    },
  };

  return { kv, sets, fakeRedis };
});

vi.mock("./redis", () => ({ redis: fakeRedis }));

import { createEdge } from "./edges";
import { graphQuery, graphRender, getNodeWithEdges } from "./graph";
import { archiveNode, createNode } from "./nodes";
import { nodeKey } from "./keys";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

const mkNode = (name: string, type: "concept" | "person" | "work" = "concept") =>
  createNode(USER, { type, name, description: `${name} description.` });

describe("graphQuery", () => {
  it("returns root node with depth 1 subgraph", async () => {
    const root = await mkNode("Root");
    const child = await mkNode("Child");
    await createEdge(USER, { from: root.id, to: child.id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: root.id, depth: 1 });

    expect(result.root.id).toBe(root.id);
    expect(result.nodes.map((n) => n.id)).toContain(child.id);
    expect(result.edges).toHaveLength(1);
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
  });

  it("traverses both directions (outgoing and incoming)", async () => {
    const center = await mkNode("Center");
    const before = await mkNode("Before");
    const after = await mkNode("After");

    await createEdge(USER, { from: before.id, to: center.id, type: "connects_to" });
    await createEdge(USER, { from: center.id, to: after.id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: center.id, depth: 1 });

    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(before.id);
    expect(ids).toContain(after.id);
  });

  it("respects depth — stops at hop boundary", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const c = await mkNode("C");

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await createEdge(USER, { from: b.id, to: c.id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: a.id, depth: 1 });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id);
  });

  it("reaches 2 hops by default", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const c = await mkNode("C");

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await createEdge(USER, { from: b.id, to: c.id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: a.id });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(c.id);
  });

  it("deduplicates nodes and edges in cycles", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await createEdge(USER, { from: b.id, to: a.id, type: "tension_with" });

    const result = await graphQuery(USER, { node_id: a.id, depth: 3 });

    const nodeIds = result.nodes.map((n) => n.id);
    const unique = new Set(nodeIds);
    expect(unique.size).toBe(nodeIds.length);
  });

  it("filters by edge_types", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const c = await mkNode("C");

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await createEdge(USER, { from: a.id, to: c.id, type: "tension_with" });

    const result = await graphQuery(USER, {
      node_id: a.id,
      depth: 1,
      edge_types: ["connects_to"],
    });

    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c.id);
  });

  it("excludes archived nodes from traversal", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await archiveNode(USER, b.id);

    const result = await graphQuery(USER, { node_id: a.id, depth: 1 });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).not.toContain(b.id);
  });

  it("throws for invalid depth", async () => {
    const a = await mkNode("A");
    await expect(graphQuery(USER, { node_id: a.id, depth: 5 })).rejects.toThrow(/Depth/);
  });

  it("throws when node not found", async () => {
    await expect(graphQuery(USER, { node_id: "missing" })).rejects.toThrow(/not found/);
  });

  it("auto-archives stale orphans and reports them", async () => {
    const orphan = await createNode(USER, {
      type: "concept",
      name: "Stale Orphan",
      description: "Never connected.",
    });
    // Backdate to 8 days ago.
    const stale = {
      ...(await import("./nodes").then((m) => m.getNode(USER, orphan.id))),
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    kv.set(nodeKey(USER, orphan.id), stale);

    const root = await mkNode("Root");
    const child = await mkNode("Child");
    await createEdge(USER, { from: root.id, to: child.id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: root.id, depth: 1 });
    expect(result.autoArchived).toBeDefined();
    expect(result.autoArchived![0]).toMatch(/Stale Orphan/);
  });

  it("resolves node by fuzzy name match", async () => {
    const node = await mkNode("Sacred Edges");
    await mkNode("Connected");
    await createEdge(USER, { from: node.id, to: (await mkNode("Other")).id, type: "connects_to" });

    const result = await graphQuery(USER, { node_id: "sacred" });
    expect(result.root.id).toBe(node.id);
  });
});

describe("graphRender", () => {
  it("produces a valid Mermaid graph LR string", async () => {
    const a = await mkNode("Sacred Edges");
    const b = await mkNode("Whitman", "person");
    await createEdge(USER, { from: b.id, to: a.id, type: "instance_of" });

    const { diagram } = await graphRender(USER, { node_id: a.id, depth: 1 });

    expect(diagram).toMatch(/^graph LR/);
    expect(diagram).toContain(`${a.id}[`);
    expect(diagram).toContain(`${b.id}[`);
    expect(diagram).toContain(`|"instance_of"|`);
    expect(diagram).toContain("Sacred Edges");
    expect(diagram).toContain("(person)");
  });
});

describe("getNodeWithEdges", () => {
  it("returns node with outgoing and incoming edges hydrated", async () => {
    const center = await mkNode("Center");
    const upstream = await mkNode("Upstream");
    const downstream = await mkNode("Downstream");

    await createEdge(USER, { from: upstream.id, to: center.id, type: "connects_to" });
    await createEdge(USER, { from: center.id, to: downstream.id, type: "evidenced_by" });

    const result = await getNodeWithEdges(USER, center.id);

    expect(result?.node.id).toBe(center.id);
    expect(result?.edges.incoming).toHaveLength(1);
    expect(result?.edges.incoming[0].source.id).toBe(upstream.id);
    expect(result?.edges.outgoing).toHaveLength(1);
    expect(result?.edges.outgoing[0].target.id).toBe(downstream.id);
  });

  it("returns null for unknown node", async () => {
    expect(await getNodeWithEdges(USER, "missing")).toBeNull();
  });

  it("resolves by fuzzy name", async () => {
    await mkNode("Song of Myself", "work");
    const result = await getNodeWithEdges(USER, "song");
    expect(result?.node.name).toBe("Song of Myself");
  });
});
