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

import {
  createEdge,
  deleteEdge,
  edgeTypesFor,
  getEdge,
  getEdgesFrom,
  getEdgesTo,
  validateEdgePair,
} from "./edges";
import { archiveNode, createNode, getNode } from "./nodes";
import { adjFromKey, adjToKey, orphansKey } from "./keys";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

const mkNode = (name: string) =>
  createNode(USER, { type: "topic", name, description: `${name} description.` });

describe("createEdge", () => {
  it("persists the edge and updates adjacency indices", async () => {
    const a = await mkNode("Node A");
    const b = await mkNode("Node B");

    const { edge } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    expect(edge.from).toBe(a.id);
    expect(edge.to).toBe(b.id);
    expect(edge.type).toBe("connects_to");
    expect(edge.id).toBeTruthy();

    expect(sets.get(adjFromKey(USER, a.id))?.has(edge.id)).toBe(true);
    expect(sets.get(adjToKey(USER, b.id))?.has(edge.id)).toBe(true);
  });

  it("reactivates an archived endpoint and reports it", async () => {
    const a = await mkNode("Hallway Contact");
    const b = await mkNode("Club");
    await archiveNode(USER, a.id);

    const { fromNode, toNode, reactivated } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    expect(reactivated).toEqual([a.id]);
    expect(fromNode.status).toBe("active");
    expect(fromNode.connectedAt).toBeTruthy();
    expect(toNode.status).toBe("active");
  });

  it("reports nothing reactivated when both ends are active", async () => {
    const a = await mkNode("Active A");
    const b = await mkNode("Active B");
    const { reactivated } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    expect(reactivated).toEqual([]);
  });

  it("removes both nodes from orphans set", async () => {
    const a = await mkNode("Alpha");
    const b = await mkNode("Beta");

    expect(sets.get(orphansKey(USER))?.has(a.id)).toBe(true);
    expect(sets.get(orphansKey(USER))?.has(b.id)).toBe(true);

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    expect(sets.get(orphansKey(USER))?.has(a.id)).toBe(false);
    expect(sets.get(orphansKey(USER))?.has(b.id)).toBe(false);
  });

  it("sets connectedAt on both nodes", async () => {
    const a = await mkNode("Source");
    const b = await mkNode("Target");
    expect(a.connectedAt).toBeUndefined();

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    const updatedA = await getNode(USER, a.id);
    const updatedB = await getNode(USER, b.id);
    expect(updatedA?.connectedAt).toBeTruthy();
    expect(updatedB?.connectedAt).toBeTruthy();
  });

  it("does not overwrite an existing connectedAt", async () => {
    const a = await mkNode("First");
    const b = await mkNode("Second");
    const c = await mkNode("Third");

    await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    const firstConnectedAt = (await getNode(USER, a.id))?.connectedAt;

    await createEdge(USER, { from: a.id, to: c.id, type: "connects_to" });
    const secondConnectedAt = (await getNode(USER, a.id))?.connectedAt;

    expect(secondConnectedAt).toBe(firstConnectedAt);
  });

  it("rejects self-loops", async () => {
    const a = await mkNode("Self");
    await expect(
      createEdge(USER, { from: a.id, to: a.id, type: "connects_to" }),
    ).rejects.toThrow(/itself/);
  });

  it("rejects when from node does not exist", async () => {
    const b = await mkNode("Target");
    await expect(
      createEdge(USER, { from: "missing", to: b.id, type: "connects_to" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects when to node does not exist", async () => {
    const a = await mkNode("Source");
    await expect(
      createEdge(USER, { from: a.id, to: "missing", type: "connects_to" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("stores evidence and notes when provided", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const { edge } = await createEdge(USER, {
      from: a.id,
      to: b.id,
      type: "connects_to",
      evidence: "See chapter 3.",
      notes: "Important connection.",
    });
    expect(edge.evidence).toBe("See chapter 3.");
    expect(edge.notes).toBe("Important connection.");
  });
});

describe("deleteEdge", () => {
  it("removes edge and updates adjacency indices", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const { edge } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    await deleteEdge(USER, edge.id);

    expect(await getEdge(USER, edge.id)).toBeNull();
    expect(sets.get(adjFromKey(USER, a.id))?.has(edge.id)).toBe(false);
    expect(sets.get(adjToKey(USER, b.id))?.has(edge.id)).toBe(false);
  });

  it("re-adds nodes to orphans when last edge is removed", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const { edge } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    await deleteEdge(USER, edge.id);

    expect(sets.get(orphansKey(USER))?.has(a.id)).toBe(true);
    expect(sets.get(orphansKey(USER))?.has(b.id)).toBe(true);
  });

  it("does not re-orphan a node that still has other edges", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const c = await mkNode("C");

    const { edge: e1 } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });
    await createEdge(USER, { from: a.id, to: c.id, type: "connects_to" });

    await deleteEdge(USER, e1.id);

    // a still has an edge to c — should not be in orphans
    expect(sets.get(orphansKey(USER))?.has(a.id)).toBe(false);
    // b lost its only edge — should be orphan again
    expect(sets.get(orphansKey(USER))?.has(b.id)).toBe(true);
  });

  it("clears connectedAt when node becomes orphaned", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const { edge } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    await deleteEdge(USER, edge.id);

    const updatedA = await getNode(USER, a.id);
    const updatedB = await getNode(USER, b.id);
    expect(updatedA?.connectedAt).toBeUndefined();
    expect(updatedB?.connectedAt).toBeUndefined();
  });

  it("returns false for unknown edge id", async () => {
    expect(await deleteEdge(USER, "missing")).toBe(false);
  });
});

describe("getEdgesFrom / getEdgesTo", () => {
  it("returns edges in the correct direction", async () => {
    const a = await mkNode("A");
    const b = await mkNode("B");
    const { edge } = await createEdge(USER, { from: a.id, to: b.id, type: "connects_to" });

    const from = await getEdgesFrom(USER, a.id);
    const to = await getEdgesTo(USER, b.id);

    expect(from.map((e) => e.id)).toContain(edge.id);
    expect(to.map((e) => e.id)).toContain(edge.id);
  });

  it("returns empty for nodes with no edges", async () => {
    const a = await mkNode("Isolated");
    expect(await getEdgesFrom(USER, a.id)).toHaveLength(0);
    expect(await getEdgesTo(USER, a.id)).toHaveLength(0);
  });
});

describe("edge pair rules", () => {
  it("accepts a valid typed pair", async () => {
    const person = await createNode(USER, { type: "person", name: "Art" });
    const group = await createNode(USER, { type: "group", name: "PSAC" });
    const { edge } = await createEdge(USER, { from: person.id, to: group.id, type: "member_of" });
    expect(edge.type).toBe("member_of");
  });

  it("rejects a wrong pair and names what would fit", async () => {
    const person = await createNode(USER, { type: "person", name: "Art" });
    const group = await createNode(USER, { type: "group", name: "PSAC" });
    await expect(
      createEdge(USER, { from: group.id, to: person.id, type: "member_of" }),
    ).rejects.toThrow(/member_of must go person → group; got group → person.*connects_to/);
  });

  it("lets connects_to join any pair", () => {
    expect(() => validateEdgePair("connects_to", "meeting", "person")).not.toThrow();
  });

  it("lists every edge type that fits a pair", () => {
    expect(edgeTypesFor("person", "topic")).toEqual(["involved_in", "can_help_with", "connects_to"]);
    expect(edgeTypesFor("group", "topic")).toEqual(["involved_in", "connects_to"]);
  });
});
