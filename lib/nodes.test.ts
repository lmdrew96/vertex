import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory shim for @upstash/redis. Implements get/set/del/sadd/srem/smembers
// — the only surface lib/nodes.ts and lib/edges.ts actually use.
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
  archiveNode,
  autoArchiveStaleOrphans,
  createNode,
  generateSlug,
  getAllTags,
  getNode,
  getOrphanIds,
  isValidDate,
  meetingName,
  parseFields,
  searchNodes,
  uniqueSlug,
  updateNode,
} from "./nodes";
import { allNodesKey, nodeKey, orphansKey } from "./keys";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

describe("generateSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(generateSlug("Sacred Edges")).toBe("sacred-edges");
  });

  it("keeps the base letter of accented names", () => {
    expect(generateSlug("José Riera")).toBe("jose-riera");
    expect(generateSlug("Ștefan Popescu")).toBe("stefan-popescu");
    expect(generateSlug("Muñoz")).toBe("munoz");
    expect(generateSlug("Ioana Mărgărit")).toBe("ioana-margarit");
  });

  it("strips special characters", () => {
    expect(generateSlug("Whitman's 'Song'!")).toBe("whitmans-song");
  });

  it("collapses multiple spaces and hyphens", () => {
    expect(generateSlug("too  many   spaces")).toBe("too-many-spaces");
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when unused", async () => {
    const slug = await uniqueSlug(USER, "Sacred Edges");
    expect(slug).toBe("sacred-edges");
  });

  it("appends -2 when base slug is taken", async () => {
    kv.set(nodeKey(USER, "sacred-edges"), { id: "sacred-edges" });
    const slug = await uniqueSlug(USER, "Sacred Edges");
    expect(slug).toBe("sacred-edges-2");
  });

  it("increments further when -2 is also taken", async () => {
    kv.set(nodeKey(USER, "sacred-edges"), {});
    kv.set(nodeKey(USER, "sacred-edges-2"), {});
    const slug = await uniqueSlug(USER, "Sacred Edges");
    expect(slug).toBe("sacred-edges-3");
  });
});

describe("createNode", () => {
  it("persists the node, adds to all-nodes set, adds to orphans set", async () => {
    const node = await createNode(USER, {
      type: "topic",
      name: "Sacred Edges",
      description: "A core concept in Vertexism.",
      tags: ["vertexism"],
    });

    expect(node.id).toBe("sacred-edges");
    expect(node.status).toBe("active");
    expect(node.connectedAt).toBeUndefined();
    expect(node.tags).toEqual(["vertexism"]);

    expect(sets.get(allNodesKey(USER))?.has(node.id)).toBe(true);
    expect(sets.get(orphansKey(USER))?.has(node.id)).toBe(true);

    const stored = await getNode(USER, node.id);
    expect(stored).toEqual(node);
  });

  it("defaults tags to empty array", async () => {
    const node = await createNode(USER, {
      type: "person",
      name: "Whitman",
      description: "The proto-Vertexist.",
    });
    expect(node.tags).toEqual([]);
  });
});

describe("updateNode", () => {
  it("updates fields and bumps updatedAt", async () => {
    const node = await createNode(USER, {
      type: "topic",
      name: "Edge State",
      description: "Original description.",
    });

    await new Promise((r) => setTimeout(r, 2));
    const updated = await updateNode(USER, node.id, {
      description: "Updated description.",
      tags: ["new-tag"],
    });

    expect(updated?.description).toBe("Updated description.");
    expect(updated?.tags).toEqual(["new-tag"]);
    expect(updated?.name).toBe("Edge State");
    expect(updated?.updatedAt).not.toBe(node.updatedAt);
  });

  it("returns null for unknown id", async () => {
    expect(await updateNode(USER, "missing", { name: "x" })).toBeNull();
  });
});

describe("archiveNode", () => {
  it("sets status to archived", async () => {
    const node = await createNode(USER, {
      type: "group",
      name: "Test Claim",
      description: "A claim.",
    });

    const archived = await archiveNode(USER, node.id);
    expect(archived?.status).toBe("archived");
  });

  it("returns null for unknown id", async () => {
    expect(await archiveNode(USER, "missing")).toBeNull();
  });
});

describe("searchNodes", () => {
  it("matches substrings in name (case-insensitive)", async () => {
    const target = await createNode(USER, {
      type: "topic",
      name: "Sacred Edges",
      description: "An idea.",
    });
    await createNode(USER, {
      type: "person",
      name: "Whitman",
      description: "A poet.",
    });

    const results = await searchNodes(USER, { query: "sacred" });
    expect(results.map((n) => n.id)).toContain(target.id);
    expect(results).toHaveLength(1);
  });

  it("matches substrings in description", async () => {
    const target = await createNode(USER, {
      type: "topic",
      name: "Continuity",
      description: "About Vertexism and flow.",
    });

    const results = await searchNodes(USER, { query: "vertexism" });
    expect(results.map((n) => n.id)).toContain(target.id);
  });

  it("ranks name matches above description-only matches", async () => {
    const nameMatch = await createNode(USER, {
      type: "topic",
      name: "Flow State",
      description: "Unrelated.",
    });
    const descMatch = await createNode(USER, {
      type: "topic",
      name: "Other Concept",
      description: "About flow and continuity.",
    });

    const results = await searchNodes(USER, { query: "flow" });
    expect(results[0].id).toBe(nameMatch.id);
    expect(results[1].id).toBe(descMatch.id);
  });

  it("filters by node type", async () => {
    await createNode(USER, {
      type: "topic",
      name: "Flow Concept",
      description: "A concept.",
    });
    const person = await createNode(USER, {
      type: "person",
      name: "Flow Person",
      description: "A person.",
    });

    const results = await searchNodes(USER, { query: "flow", type: "person" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(person.id);
  });

  it("excludes archived nodes by default", async () => {
    const node = await createNode(USER, {
      type: "topic",
      name: "Old Idea",
      description: "An archived concept.",
    });
    await archiveNode(USER, node.id);

    const results = await searchNodes(USER, { query: "old" });
    expect(results).toHaveLength(0);

    const withArchived = await searchNodes(USER, {
      query: "old",
      include_archived: true,
    });
    expect(withArchived).toHaveLength(1);
  });
});

describe("autoArchiveStaleOrphans", () => {
  it("archives orphan nodes older than 7 days and returns messages", async () => {
    const node = await createNode(USER, {
      type: "topic",
      name: "Stale Idea",
      description: "Never connected.",
    });

    // Backdate createdAt to 8 days ago.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const staleNode = { ...node, createdAt: eightDaysAgo };
    kv.set(nodeKey(USER, node.id), staleNode);

    const archived = await autoArchiveStaleOrphans(USER);
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatch(/Archived orphaned node: Stale Idea/);

    const updated = await getNode(USER, node.id);
    expect(updated?.status).toBe("archived");
  });

  it("does not archive orphans within 7 days", async () => {
    await createNode(USER, {
      type: "topic",
      name: "Fresh Idea",
      description: "Just created.",
    });

    const archived = await autoArchiveStaleOrphans(USER);
    expect(archived).toHaveLength(0);
  });

  it("returns empty when there are no orphans", async () => {
    const archived = await autoArchiveStaleOrphans(USER);
    expect(archived).toHaveLength(0);
  });
});

describe("getAllTags", () => {
  it("returns distinct, sorted tags across all nodes", async () => {
    await createNode(USER, {
      type: "topic",
      name: "A",
      description: "d",
      tags: ["domain:sla", "origin:nae"],
    });
    await createNode(USER, {
      type: "group",
      name: "B",
      description: "d",
      tags: ["domain:sla", "origin:literature"],
    });

    const tags = await getAllTags(USER);
    expect(tags).toEqual(["domain:sla", "origin:literature", "origin:nae"]);
  });

  it("returns an empty array when there are no nodes", async () => {
    expect(await getAllTags(USER)).toEqual([]);
  });
});

describe("getOrphanIds", () => {
  it("returns node ids with no edges", async () => {
    const node = await createNode(USER, {
      type: "topic",
      name: "Unanswered Question",
      description: "Still isolated.",
    });

    const orphans = await getOrphanIds(USER);
    expect(orphans).toContain(node.id);
  });
});

describe("isValidDate", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isValidDate("2026-10-14")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
  });

  it("rejects malformed or impossible dates", () => {
    expect(isValidDate("2026-10-14T10:00:00Z")).toBe(false);
    expect(isValidDate("10/14/2026")).toBe(false);
    expect(isValidDate("2026-02-30")).toBe(false);
  });
});

describe("parseFields", () => {
  it("takes kind per type: meeting/event on meetings, group kinds on groups", () => {
    expect(parseFields("meeting", { date: "2026-09-30", kind: "event" })).toEqual({ date: "2026-09-30", kind: "event" });
    expect(() => parseFields("meeting", { date: "2026-09-30", kind: "club" })).toThrow(/meeting must be one of: meeting, event/);
    expect(() => parseFields("group", { kind: "event" })).toThrow(/group must be one of: council/);
    expect(parseFields("meeting", { kind: null }, true)).toEqual({ kind: null });
  });

  it("requires date on meetings", () => {
    expect(() => parseFields("meeting", undefined)).toThrow(/fields.date/);
    expect(() => parseFields("meeting", { notes: "x" })).toThrow(/fields.date/);
  });

  it("rejects fields that belong to another type", () => {
    expect(() => parseFields("person", { kind: "club" })).toThrow(/Allowed: role/);
    expect(() => parseFields("topic", { role: "x" })).toThrow(/no extra fields/);
  });

  it("validates group kind and follow-up IDs", () => {
    expect(() => parseFields("group", { kind: "cult" })).toThrow(/council/);
    expect(() =>
      parseFields("meeting", { date: "2026-10-14", followUpTaskIds: "abc" }),
    ).toThrow(/followUpTaskIds/);
  });

  it("allows null to clear a key only on partial updates, never date", () => {
    expect(parseFields("person", { role: null }, true)).toEqual({ role: null });
    expect(() => parseFields("person", { role: null })).toThrow(/cannot be cleared/);
    expect(() => parseFields("meeting", { date: null }, true)).toThrow(/cannot be cleared/);
  });
});

describe("meeting nodes", () => {
  it("auto-names from the date when no name is given", async () => {
    const node = await createNode(USER, { type: "meeting", fields: { date: "2026-10-14" } });
    expect(node.name).toBe("2026-10-14");
    expect(node.id).toBe("2026-10-14");
    expect(node.description).toBe("");
  });

  it("formats context into the name and slugs it cleanly", async () => {
    const name = meetingName("2026-10-14", "PSAC");
    expect(name).toBe("2026-10-14 · PSAC");
    const node = await createNode(USER, { type: "meeting", name, fields: { date: "2026-10-14" } });
    expect(node.id).toBe("2026-10-14-psac");
  });

  it("stores fields and keeps them through an update", async () => {
    const node = await createNode(USER, {
      type: "meeting",
      fields: { date: "2026-10-14", notes: "**Pilot** idea", followUpTaskIds: ["t1"] },
    });
    const updated = await updateNode(USER, node.id, { fields: { ccEventId: "evt_1" } });
    expect(updated?.fields).toEqual({
      date: "2026-10-14",
      notes: "**Pilot** idea",
      followUpTaskIds: ["t1"],
      ccEventId: "evt_1",
    });
  });
});

describe("person fields", () => {
  it("omits fields when none are given", async () => {
    const node = await createNode(USER, { type: "person", name: "Art Trembanis" });
    expect(node.fields).toBeUndefined();
  });

  it("merges and clears fields on update", async () => {
    const node = await createNode(USER, {
      type: "person",
      name: "Art Trembanis",
      fields: { role: "Professor", affiliation: "UD" },
    });
    const updated = await updateNode(USER, node.id, { fields: { role: null, email: "a@udel.edu" } });
    expect(updated?.fields).toEqual({ affiliation: "UD", email: "a@udel.edu" });
  });

  it("rejects a name with no letters or numbers", async () => {
    await expect(createNode(USER, { type: "person", name: "!!!" })).rejects.toThrow(/letter or number/);
  });
});
