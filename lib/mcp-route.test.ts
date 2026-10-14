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

import { POST } from "../app/[userId]/mcp/route";
import { createAccount, rotateToken } from "./auth";

const LEGACY = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

beforeEach(() => {
  kv.clear();
  sets.clear();
});

const call = (token: string, body: unknown) =>
  POST(
    new Request(`https://vertex.adhdesigns.dev/${token}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId: token }) },
  );

const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const createPerson = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/call",
  params: { name: "vtx_node_create", arguments: { type: "person", name: "Art Trembanis" } },
};
const search = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "vtx_node_search", arguments: { query: "art" } },
};

describe("MCP route auth", () => {
  it("keeps an unclaimed connector URL working (tools/list POST)", async () => {
    const res = await call(LEGACY, toolsList);
    expect(res.status).toBe(200);
    expect((await res.json()).result.tools.length).toBeGreaterThan(0);
  });

  it("keeps the same URL working after the account claims it, with the same data", async () => {
    await call(LEGACY, createPerson);
    await createAccount("nae@example.com", "correct horse battery", LEGACY);

    const list = await call(LEGACY, toolsList);
    expect(list.status).toBe(200);
    const found = await (await call(LEGACY, search)).json();
    expect(found.result.content[0].text).toContain("Art Trembanis");
  });

  it("401s the old URL after rotation and serves the same graph on the new one", async () => {
    await call(LEGACY, createPerson);
    const account = await createAccount("nae@example.com", "correct horse battery", LEGACY);
    const next = await rotateToken(account);

    const old = await call(LEGACY, toolsList);
    expect(old.status).toBe(401);
    expect((await old.json()).error.message).toMatch(/invalid or was replaced/);

    const found = await (await call(next.token, search)).json();
    expect(found.result.content[0].text).toContain("Art Trembanis");
  });

  it("401s a malformed token", async () => {
    expect((await call("bad token!", toolsList)).status).toBe(401);
  });
});
