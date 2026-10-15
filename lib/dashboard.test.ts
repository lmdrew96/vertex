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
import { getDashboard } from "./dashboard";
import { createEdge } from "./edges";
import { logMeeting } from "./meetings";
import { archiveNode, createNode } from "./nodes";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

describe("getDashboard", () => {
  it("lists recent meetings newest first with attendees and group, capped at 5", async () => {
    for (const day of ["01", "02", "03", "04", "05", "06"]) {
      await logMeeting(USER, { date: `2026-10-${day}`, attendees: ["Dana Lee"] });
    }
    await logMeeting(USER, { date: "2026-10-13", attendees: ["Art Trembanis", "Dana Lee"], group: "PSAC" });

    const { recentMeetings } = await getDashboard(USER);
    expect(recentMeetings).toHaveLength(5);
    expect(recentMeetings[0]).toMatchObject({
      date: "2026-10-13",
      name: "2026-10-13 · PSAC",
      group: { id: "psac", name: "PSAC" },
      attendees: [
        { id: "art-trembanis", name: "Art Trembanis" },
        { id: "dana-lee", name: "Dana Lee" },
      ],
    });
    expect(recentMeetings.map((m) => m.date)).toEqual([
      "2026-10-13",
      "2026-10-06",
      "2026-10-05",
      "2026-10-04",
      "2026-10-03",
    ]);
  });

  it("builds threads from topics meetings were about, ordered by latest meeting", async () => {
    await logMeeting(USER, { date: "2026-09-30", attendees: ["Art Trembanis"], topics: ["Senior thesis"] });
    await logMeeting(USER, {
      date: "2026-10-10",
      attendees: ["Art Trembanis", "Dana Lee"],
      topics: ["AAP student advocacy", "Senior thesis"],
    });
    await logMeeting(USER, { date: "2026-10-12", attendees: ["Dana Lee"], topics: ["AAP student advocacy"] });
    // A person linked straight to the topic counts too; a topic with no meeting isn't a thread.
    await createNode(USER, { type: "person", name: "Sam Ortiz" });
    await createEdge(USER, { from: "sam-ortiz", to: "senior-thesis", type: "can_help_with" });
    await createNode(USER, { type: "topic", name: "Loose idea" });

    const { threads } = await getDashboard(USER);
    expect(threads).toEqual([
      { id: "aap-student-advocacy", name: "AAP student advocacy", peopleCount: 2, meetingCount: 2, lastMeetingDate: "2026-10-12" },
      { id: "senior-thesis", name: "Senior thesis", peopleCount: 3, meetingCount: 2, lastMeetingDate: "2026-10-10" },
    ]);
  });

  it("leaves archived nodes out", async () => {
    await logMeeting(USER, { date: "2026-10-10", attendees: ["Dana Lee"], topics: ["Senior thesis"] });
    const meetingId = (await getDashboard(USER)).recentMeetings[0].id;
    await archiveNode(USER, meetingId);

    const dash = await getDashboard(USER);
    expect(dash.recentMeetings).toEqual([]);
    expect(dash.threads).toEqual([]);
    expect(dash.nodes.some((n) => n.id === meetingId)).toBe(false);
  });
});
