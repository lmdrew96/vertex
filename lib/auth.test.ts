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
  createAccount,
  getAccount,
  hashPassword,
  parseVertexToken,
  resolveGraphId,
  rotateToken,
  verifyPassword,
  type Account,
} from "./auth";
import { createNode, listNodes } from "./nodes";

const LEGACY = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

beforeEach(() => {
  kv.clear();
  sets.clear();
  vi.clearAllMocks();
});

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hashed = await hashPassword("correct horse battery");
    const account = { ...hashed } as Account;
    expect(hashed.iterations).toBe(100_000);
    expect(await verifyPassword(account, "correct horse battery")).toBe(true);
    expect(await verifyPassword(account, "wrong horse battery")).toBe(false);
  });

  it("never stores the password itself", async () => {
    const account = await createAccount("nae@example.com", "correct horse battery");
    expect(JSON.stringify(account)).not.toContain("correct horse battery");
  });
});

describe("parseVertexToken", () => {
  it("pulls the token out of a full MCP URL", () => {
    expect(parseVertexToken(`https://vertex.adhdesigns.dev/${LEGACY.toUpperCase()}/mcp`)).toBe(LEGACY);
  });

  it("accepts a bare token and rejects junk", () => {
    expect(parseVertexToken(LEGACY)).toBe(LEGACY);
    expect(parseVertexToken("not a token!")).toBeNull();
    expect(parseVertexToken("   ")).toBeNull();
  });
});

describe("resolveGraphId", () => {
  it("lets a never-claimed token keep working as its own graph", async () => {
    expect(await resolveGraphId(LEGACY)).toBe(LEGACY);
  });

  it("rejects malformed tokens", async () => {
    expect(await resolveGraphId("a/b")).toBeNull();
    expect(await resolveGraphId("short")).toBeNull();
  });
});

describe("createAccount", () => {
  it("mints a fresh token that is also the graph namespace", async () => {
    const account = await createAccount("nae@example.com", "correct horse battery");
    expect(account.graphId).toBe(account.token);
    expect(await resolveGraphId(account.token)).toBe(account.graphId);
  });

  it("claims an existing token so its URL and graph keep working", async () => {
    await createNode(LEGACY, { type: "person", name: "Art Trembanis" });
    const account = await createAccount(
      "nae@example.com",
      "correct horse battery",
      `https://vertex.adhdesigns.dev/${LEGACY}/mcp`,
    );
    expect(account.token).toBe(LEGACY);
    expect(account.graphId).toBe(LEGACY);
    const graphId = await resolveGraphId(LEGACY);
    expect((await listNodes(graphId!)).map((n) => n.name)).toEqual(["Art Trembanis"]);
  });

  it("refuses to claim a token another account owns", async () => {
    await createAccount("nae@example.com", "correct horse battery", LEGACY);
    await expect(createAccount("other@example.com", "correct horse battery", LEGACY)).rejects.toThrow(
      /already belongs/,
    );
  });

  it("refuses to claim a retired token", async () => {
    const account = await createAccount("nae@example.com", "correct horse battery", LEGACY);
    await rotateToken(account);
    await expect(createAccount("other@example.com", "correct horse battery", LEGACY)).rejects.toThrow(
      /already belongs/,
    );
  });

  it("rejects a malformed claim and a duplicate email", async () => {
    await expect(createAccount("nae@example.com", "correct horse battery", "nope nope")).rejects.toThrow(
      /isn't a valid token/,
    );
    await createAccount("nae@example.com", "correct horse battery");
    await expect(createAccount("nae@example.com", "correct horse battery")).rejects.toThrow(/already exists/);
  });
});

describe("rotateToken", () => {
  it("issues a new token for the same graph and retires the old one", async () => {
    await createNode(LEGACY, { type: "topic", name: "Mentorship pilot" });
    const account = await createAccount("nae@example.com", "correct horse battery", LEGACY);

    const next = await rotateToken(account);

    expect(next.token).not.toBe(LEGACY);
    expect(next.graphId).toBe(LEGACY);
    expect(await resolveGraphId(next.token)).toBe(LEGACY);
    expect(await resolveGraphId(LEGACY)).toBeNull();
    expect((await listNodes((await resolveGraphId(next.token))!)).map((n) => n.name)).toEqual([
      "Mentorship pilot",
    ]);
    expect((await getAccount("nae@example.com"))?.token).toBe(next.token);
  });

  it("retires every earlier token across repeated rotations", async () => {
    const first = await createAccount("nae@example.com", "correct horse battery");
    const second = await rotateToken(first);
    const third = await rotateToken(second);
    expect(await resolveGraphId(first.token)).toBeNull();
    expect(await resolveGraphId(second.token)).toBeNull();
    expect(await resolveGraphId(third.token)).toBe(first.graphId);
  });
});
