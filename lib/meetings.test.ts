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

import { logMeeting } from "./meetings";
import { archiveNode, createNode, getNode, listNodes } from "./nodes";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

const logged = async (input: Parameters<typeof logMeeting>[1]) => {
  const result = await logMeeting(USER, input);
  if (result.status !== "logged") throw new Error(`expected logged, got ${JSON.stringify(result)}`);
  return result;
};

describe("logMeeting — creating", () => {
  it("creates the meeting, new nodes, and all edges in one call", async () => {
    const result = await logged({
      date: "2026-10-14",
      attendees: ["Art Trembanis", "Dana Lee"],
      group: "PSAC",
      topics: ["Mentorship pilot"],
      notes: "Talked about the **alum survey**.",
      ccEventId: "evt_1",
      followUpTaskIds: ["task_1"],
    });

    expect(result.meeting.name).toBe("2026-10-14 · PSAC");
    expect(result.meeting.id).toBe("2026-10-14-psac");
    expect(result.meeting.fields).toEqual({
      date: "2026-10-14",
      notes: "Talked about the **alum survey**.",
      ccEventId: "evt_1",
      followUpTaskIds: ["task_1"],
    });
    expect(result.created.map((c) => c.type).sort()).toEqual(["group", "person", "person", "topic"]);
    expect(result.edges.map((e) => e.type).sort()).toEqual(["about", "attended", "attended", "held_by"]);
    expect(result.meeting.connectedAt).toBeTruthy();
  });

  it("names the meeting after the first attendee when there's no group", async () => {
    const result = await logged({ date: "2026-10-14", attendees: ["Art Trembanis"] });
    expect(result.meeting.name).toBe("2026-10-14 · Art Trembanis");
  });

  it("logs an event when kind is event, and leaves kind unset otherwise", async () => {
    const event = await logged({ date: "2026-09-30", name: "Trustees luncheon", kind: "event", attendees: ["Art"] });
    expect(event.meeting.fields.kind).toBe("event");
    const meeting = await logged({ date: "2026-10-14", attendees: ["Art"] });
    expect(meeting.meeting.fields.kind).toBeUndefined();
  });

  it("uses an explicit name when given", async () => {
    const result = await logged({ date: "2026-10-14", name: "Coffee chat", attendees: ["Art"] });
    expect(result.meeting.name).toBe("Coffee chat");
  });

  it("collapses a repeated new name into one node", async () => {
    const result = await logged({ date: "2026-10-14", attendees: ["Art", "art"] });
    expect(result.created).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
  });
});

describe("logMeeting — matching", () => {
  it("matches an existing active node by exact name, case-insensitively", async () => {
    const art = await createNode(USER, { type: "person", name: "Art Trembanis" });
    const result = await logged({ date: "2026-10-14", attendees: ["art trembanis"] });
    expect(result.matched).toEqual([{ id: art.id, name: "Art Trembanis", type: "person" }]);
    expect(result.created).toHaveLength(0);
  });

  it("matches by node ID", async () => {
    const psac = await createNode(USER, { type: "group", name: "PSAC" });
    const result = await logged({ date: "2026-10-14", group: psac.id });
    expect(result.matched[0].id).toBe(psac.id);
  });

  it("only matches nodes of the right type", async () => {
    await createNode(USER, { type: "topic", name: "Advising" });
    const result = await logged({ date: "2026-10-14", group: "Advising" });
    expect(result.created).toEqual([expect.objectContaining({ type: "group" })]);
  });

  it("rejects an ID of the wrong type", async () => {
    const topic = await createNode(USER, { type: "topic", name: "Advising" });
    await expect(logMeeting(USER, { date: "2026-10-14", group: topic.id })).rejects.toThrow(
      /is a topic node/,
    );
  });
});

describe("logMeeting — needs_choice", () => {
  it("returns candidates for a partial person match and creates nothing", async () => {
    const art = await createNode(USER, {
      type: "person",
      name: "Art Trembanis",
      fields: { role: "Professor" },
    });
    const before = (await listNodes(USER)).length;

    const result = await logMeeting(USER, { date: "2026-10-14", attendees: ["Trembanis"], group: "PSAC" });

    expect(result.status).toBe("needs_choice");
    if (result.status !== "needs_choice") return;
    expect(result.choices).toEqual([
      {
        field: "attendees",
        input: "Trembanis",
        reason: "similar",
        candidates: [{ id: art.id, name: "Art Trembanis", type: "person", status: "active", role: "Professor" }],
      },
    ]);
    expect((await listNodes(USER)).length).toBe(before);
  });

  it("returns candidates when two active nodes share the name", async () => {
    await createNode(USER, { type: "person", name: "Sam Park" });
    await createNode(USER, { type: "person", name: "Sam Park" });
    const result = await logMeeting(USER, { date: "2026-10-14", attendees: ["Sam Park"] });
    expect(result.status).toBe("needs_choice");
    if (result.status !== "needs_choice") return;
    expect(result.choices[0].reason).toBe("ambiguous");
    expect(result.choices[0].candidates).toHaveLength(2);
  });

  it("surfaces an archived exact match instead of duplicating it", async () => {
    const old = await createNode(USER, { type: "person", name: "Hallway Person" });
    await archiveNode(USER, old.id);
    const result = await logMeeting(USER, { date: "2026-10-14", attendees: ["Hallway Person"] });
    expect(result.status).toBe("needs_choice");
    if (result.status !== "needs_choice") return;
    expect(result.choices[0].reason).toBe("archived");
  });

  it("collects every choice in one response", async () => {
    await createNode(USER, { type: "person", name: "Art Trembanis" });
    await createNode(USER, { type: "person", name: "Dana Lee" });
    const result = await logMeeting(USER, { date: "2026-10-14", attendees: ["Trembanis", "Dana"] });
    expect(result.status === "needs_choice" && result.choices).toHaveLength(2);
  });

  it("does not fuzzy-match groups or topics", async () => {
    await createNode(USER, { type: "group", name: "Public Service Council" });
    const result = await logged({ date: "2026-10-14", group: "Service Club" });
    expect(result.created).toHaveLength(1);
  });
});

describe("logMeeting — resolving a choice", () => {
  it("creates a new person when the name is in confirmNew", async () => {
    await createNode(USER, { type: "person", name: "Art Trembanis" });
    const result = await logged({
      date: "2026-10-14",
      attendees: ["Beth Trembanis"],
      confirmNew: ["beth trembanis"],
    });
    expect(result.created).toEqual([expect.objectContaining({ name: "Beth Trembanis" })]);
  });

  it("reactivates an archived node passed by ID", async () => {
    const old = await createNode(USER, { type: "person", name: "Hallway Person" });
    await archiveNode(USER, old.id);
    const result = await logged({ date: "2026-10-14", attendees: [old.id] });
    expect(result.reactivated).toEqual([{ id: old.id, name: "Hallway Person", type: "person" }]);
    expect((await getNode(USER, old.id))?.status).toBe("active");
  });
});

describe("logMeeting — validation", () => {
  it("requires a real date", async () => {
    await expect(logMeeting(USER, { date: "Oct 14", attendees: ["Art"] })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("requires at least one attendee or a group", async () => {
    await expect(logMeeting(USER, { date: "2026-10-14", topics: ["Pilot"], notes: "x" })).rejects.toThrow(
      /at least one attendee or a group/,
    );
    expect(await listNodes(USER)).toHaveLength(0);
  });
});
