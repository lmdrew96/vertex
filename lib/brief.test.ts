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
import { brief, whoKnows } from "./brief";
import { createEdge } from "./edges";
import { logMeeting } from "./meetings";
import { archiveNode, createNode, searchNodeHits } from "./nodes";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

const ok = async (ref: string, limit?: number) => {
  const result = await brief(USER, ref, limit);
  if (result?.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
};

// Two PSAC meetings with Art, one coffee chat with Art + Dana about mentorship.
const seed = async () => {
  await createNode(USER, {
    type: "person",
    name: "Art Trembanis",
    fields: { role: "Professor", affiliation: "UD" },
  });
  await logMeeting(USER, {
    date: "2026-09-30",
    attendees: ["Art Trembanis"],
    group: "PSAC",
    topics: ["Alum survey"],
    notes: "First pass at the alum survey.",
    followUpTaskIds: ["task_old"],
  });
  await logMeeting(USER, {
    date: "2026-10-14",
    attendees: ["art-trembanis", "Dana Lee"],
    group: "psac",
    topics: ["Mentorship pilot"],
    notes: "Talked about the **mentorship pilot** and public service careers.",
    followUpTaskIds: ["task_new"],
  });
};

describe("brief", () => {
  it("briefs a person: last contact, meetings newest first, co-attendees, groups, topics", async () => {
    await seed();
    const result = await ok("Art Trembanis");

    expect(result.node.id).toBe("art-trembanis");
    expect(result.lastContact).toBe("2026-10-14");
    expect(result.recentMeetings.map((m) => m.date)).toEqual(["2026-10-14", "2026-09-30"]);
    expect(result.recentMeetings[0].notesExcerpt).toContain("mentorship pilot");
    expect(result.people).toEqual([
      { id: "dana-lee", name: "Dana Lee", links: ["at 2026-10-14 · PSAC"] },
    ]);
    expect(result.groups[0]).toMatchObject({ name: "PSAC" });
    expect(result.groups[0].links).toHaveLength(2);
    expect(result.topics.map((t) => t.name).sort()).toEqual(["Alum survey", "Mentorship pilot"]);
    expect(result.openFollowUps.map((f) => f.taskId)).toEqual(["task_new", "task_old"]);
  });

  it("respects limit_meetings for meetings and follow-ups but not lastContact", async () => {
    await seed();
    const result = await ok("art-trembanis", 1);
    expect(result.recentMeetings).toHaveLength(1);
    expect(result.openFollowUps.map((f) => f.taskId)).toEqual(["task_new"]);
    expect(result.lastContact).toBe("2026-10-14");
  });

  it("briefs a group through its meetings, with role and affiliation on people", async () => {
    await seed();
    const result = await ok("PSAC");
    expect(result.recentMeetings).toHaveLength(2);
    expect(result.people[0]).toMatchObject({
      name: "Art Trembanis",
      role: "Professor",
      affiliation: "UD",
    });
    expect(result.people[0].links).toHaveLength(2);
  });

  it("shows direct edges in plain language", async () => {
    await seed();
    const psac = (await ok("PSAC")).node;
    await createEdge(USER, { from: "dana-lee", to: psac.id, type: "member_of" });
    await createEdge(USER, { from: "dana-lee", to: "art-trembanis", type: "introduced" });

    expect((await ok("PSAC")).people.find((p) => p.name === "Dana Lee")?.links).toContain(
      "Dana Lee member of PSAC",
    );
    expect((await ok("Art Trembanis")).people[0].links).toContain(
      "Dana Lee introduced Nae to Art Trembanis",
    );
  });

  it("briefs a meeting as itself", async () => {
    await seed();
    const result = await ok("2026-10-14-psac");
    expect(result.recentMeetings.map((m) => m.id)).toEqual(["2026-10-14-psac"]);
    expect(result.people.map((p) => p.name).sort()).toEqual(["Art Trembanis", "Dana Lee"]);
  });

  it("resolves a partial name and asks when it's ambiguous", async () => {
    await seed();
    expect((await ok("trembanis")).node.id).toBe("art-trembanis");
    await createNode(USER, { type: "person", name: "Beth Trembanis" });
    const result = await brief(USER, "trembanis");
    expect(result?.status).toBe("needs_choice");
  });

  it("skips archived neighbors and returns null for unknown nodes", async () => {
    await seed();
    await archiveNode(USER, "dana-lee");
    expect((await ok("Art Trembanis")).people).toHaveLength(0);
    expect(await brief(USER, "nobody")).toBeNull();
  });

  it("handles a node with no meetings", async () => {
    await createNode(USER, { type: "topic", name: "Grad school" });
    const result = await ok("Grad school");
    expect(result.lastContact).toBeNull();
    expect(result.recentMeetings).toEqual([]);
  });
});

describe("whoKnows", () => {
  it("ranks can_help_with > involved_in > mentioned, with reasons", async () => {
    await seed();
    await createNode(USER, { type: "person", name: "Kim Ortiz" });
    await createNode(USER, { type: "person", name: "Lee Park" });
    await createNode(USER, { type: "topic", name: "Public service" });
    await createEdge(USER, { from: "kim-ortiz", to: "public-service", type: "can_help_with" });
    await createEdge(USER, { from: "lee-park", to: "public-service", type: "involved_in" });

    const result = await whoKnows(USER, "public service");

    expect(result.matchedTopics.map((t) => t.name)).toEqual(["Public service"]);
    expect(result.people.map((p) => [p.name, p.strength])).toEqual([
      ["Kim Ortiz", "can_help_with"],
      ["Lee Park", "involved_in"],
      ["Art Trembanis", "mentioned"],
      ["Dana Lee", "mentioned"],
    ]);
    expect(result.people[0].why).toEqual(["can help with Public service"]);
    expect(result.people[2].why).toEqual(["mentioned in notes of 2026-10-14 · PSAC"]);
  });

  it("credits attendees of meetings about a matched topic", async () => {
    await seed();
    const result = await whoKnows(USER, "alum survey");
    expect(result.people[0]).toMatchObject({ name: "Art Trembanis", strength: "mentioned" });
    expect(result.people[0].why).toContain("at 2026-09-30 · PSAC (about Alum survey)");
  });

  it("matches a topic named inside a longer query, on whole words only", async () => {
    await createNode(USER, { type: "topic", name: "AI" });
    expect((await whoKnows(USER, "who works on AI policy")).matchedTopics).toHaveLength(1);
    expect((await whoKnows(USER, "what she said")).matchedTopics).toHaveLength(0);
  });

  it("finds people whose own profile mentions the query", async () => {
    await createNode(USER, {
      type: "person",
      name: "Ana Ruiz",
      fields: { role: "Public Service Fellow" },
    });
    const result = await whoKnows(USER, "public service");
    expect(result.people).toEqual([
      expect.objectContaining({ name: "Ana Ruiz", strength: "mentioned", why: ["their profile mentions it"] }),
    ]);
  });

  it("rejects an empty query", async () => {
    await expect(whoKnows(USER, "  ")).rejects.toThrow(/query/);
  });
});

describe("searchNodeHits", () => {
  it("matches meeting notes and ranks name > description > notes", async () => {
    await seed();
    await createNode(USER, { type: "topic", name: "Mentorship circles" });
    await createNode(USER, { type: "group", name: "Peer group", description: "Runs a mentorship program." });

    const hits = await searchNodeHits(USER, { query: "mentorship" });

    expect(hits.map((h) => [h.node.name, h.matchedIn])).toEqual([
      ["Mentorship circles", "name"],
      ["Mentorship pilot", "name"],
      ["Peer group", "description"],
      ["2026-10-14 · PSAC", "notes"],
    ]);
  });
});
