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

const r2 = vi.hoisted(() => ({
  objects: new Map<string, { contentType: string; size: number }>(),
  deleted: [] as string[],
  failDelete: false,
}));

vi.mock("./r2", () => ({
  R2NotConfiguredError: class extends Error {},
  presignPutUrl: async (key: string) => `https://r2.test/put/${key}`,
  presignGetUrl: async (key: string) => `https://r2.test/get/${key}`,
  headObject: async (key: string) => r2.objects.get(key) ?? null,
  deleteObject: async (key: string) => {
    if (r2.failDelete) throw new Error("R2 DELETE failed (500)");
    r2.deleted.push(key);
    r2.objects.delete(key);
  },
}));

import {
  confirmUpload,
  deleteAttachment,
  getAttachment,
  linkAttachment,
  listNodeAttachments,
  requestUpload,
  safeFilename,
} from "./attachments";
import { brief, whoKnows } from "./brief";
import { pendingUploadKey } from "./keys";
import { logMeeting } from "./meetings";
import { createNode, searchNodeHits } from "./nodes";

const USER = "user_test";

beforeEach(() => {
  kv.clear();
  sets.clear();
  r2.objects.clear();
  r2.deleted.length = 0;
  r2.failDelete = false;
});

const pdf = { filename: "PSAC agenda.pdf", contentType: "application/pdf", size: 2048 };

// Request + simulate the client's PUT + confirm.
const upload = async (nodeIds: string[], text?: string, file = pdf) => {
  const req = await requestUpload(USER, { nodeIds, ...file });
  const pending = kv.get(pendingUploadKey(USER, req.attachmentId)) as { r2Key: string };
  r2.objects.set(pending.r2Key, { contentType: file.contentType, size: file.size });
  return confirmUpload(USER, req.attachmentId, text);
};

describe("requestUpload", () => {
  it("returns an upload URL and attaches nothing until confirmed", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const req = await requestUpload(USER, { nodeIds: [art.id], ...pdf, caption: "Agenda" });
    expect(req.uploadUrl).toContain(`vertex/${USER}/${req.attachmentId}/PSAC-agenda.pdf`);
    expect(await listNodeAttachments(USER, art.id)).toEqual([]);
  });

  it("rejects HEIC with a convert-first message", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    await expect(
      requestUpload(USER, { nodeIds: [art.id], filename: "IMG_1.HEIC", contentType: "image/heic", size: 10 }),
    ).rejects.toThrow(/Convert the photo to JPEG/);
  });

  it("rejects unsupported types, oversize files, and unknown nodes", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    await expect(
      requestUpload(USER, { nodeIds: [art.id], filename: "a.gif", contentType: "image/gif", size: 10 }),
    ).rejects.toThrow(/Unsupported file type/);
    await expect(requestUpload(USER, { nodeIds: [art.id], ...pdf, size: 11 * 1024 * 1024 })).rejects.toThrow(
      /10 MB/,
    );
    await expect(requestUpload(USER, { nodeIds: ["ghost"], ...pdf })).rejects.toThrow(/not found: ghost/);
  });
});

describe("confirmUpload", () => {
  it("saves Coru-provided text as 'provided' and indexes the file on every node", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const psac = await createNode(USER, { type: "group", name: "PSAC" });
    const att = await upload([art.id, psac.id], "Agenda: alum survey");
    expect(att.extractStatus).toBe("provided");
    expect(att.extractedText).toBe("Agenda: alum survey");
    expect((await listNodeAttachments(USER, psac.id)).map((a) => a.id)).toEqual([att.id]);
  });

  it("leaves extraction pending when no text is given", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    expect((await upload([art.id])).extractStatus).toBe("pending");
  });

  it("asks for the PUT when nothing was uploaded, and keeps the request alive", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const req = await requestUpload(USER, { nodeIds: [art.id], ...pdf });
    await expect(confirmUpload(USER, req.attachmentId)).rejects.toThrow(/No file at the upload URL/);
    expect(kv.has(pendingUploadKey(USER, req.attachmentId))).toBe(true);
  });

  it("discards an upload whose real type doesn't match", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const req = await requestUpload(USER, { nodeIds: [art.id], ...pdf });
    const { r2Key } = kv.get(pendingUploadKey(USER, req.attachmentId)) as { r2Key: string };
    r2.objects.set(r2Key, { contentType: "text/html", size: 10 });
    await expect(confirmUpload(USER, req.attachmentId)).rejects.toThrow(/discarded/);
    expect(r2.deleted).toEqual([r2Key]);
    expect(await getAttachment(USER, req.attachmentId)).toBeNull();
  });

  it("is safe to confirm twice and errors on unknown IDs", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const att = await upload([art.id]);
    expect((await confirmUpload(USER, att.id)).id).toBe(att.id);
    await expect(confirmUpload(USER, "nope")).rejects.toThrow(/Unknown or expired/);
  });

  it("truncates provided text at 50k characters", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const att = await upload([art.id], "x".repeat(60_000));
    expect(att.extractedText).toHaveLength(50_000);
  });
});

describe("linkAttachment / deleteAttachment", () => {
  it("adds and removes nodes but never leaves a file on none", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const psac = await createNode(USER, { type: "group", name: "PSAC" });
    const att = await upload([art.id]);

    const moved = await linkAttachment(USER, att.id, { add: [psac.id], remove: [art.id] });
    expect(moved.nodeIds).toEqual([psac.id]);
    expect(await listNodeAttachments(USER, art.id)).toEqual([]);
    await expect(linkAttachment(USER, att.id, { remove: [psac.id] })).rejects.toThrow(/at least one node/);
  });

  it("deletes the stored file before the record", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const att = await upload([art.id]);
    await deleteAttachment(USER, att.id);
    expect(r2.deleted).toEqual([att.r2Key]);
    expect(await getAttachment(USER, att.id)).toBeNull();
    expect(await listNodeAttachments(USER, art.id)).toEqual([]);
  });

  it("keeps the record when the storage delete fails", async () => {
    const art = await createNode(USER, { type: "person", name: "Art" });
    const att = await upload([art.id]);
    r2.failDelete = true;
    await expect(deleteAttachment(USER, att.id)).rejects.toThrow(/DELETE failed/);
    expect(await getAttachment(USER, att.id)).not.toBeNull();
  });
});

describe("safeFilename", () => {
  it("keeps a readable name without path tricks", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("My Notes (Oct 14).md")).toBe("My-Notes-Oct-14-.md");
    expect(safeFilename("???")).toBe("file");
  });
});

describe("attachments in search, brief, and who_knows", () => {
  const seed = async () => {
    const result = await logMeeting(USER, { date: "2026-10-14", attendees: ["Art Trembanis"], group: "PSAC" });
    if (result.status !== "logged") throw new Error("seed failed");
    const att = await upload([result.meeting.id], "Handout: the Truman scholarship timeline.");
    return { meeting: result.meeting, att };
  };

  it("search ranks attachment text last and names the file", async () => {
    const { meeting } = await seed();
    const hits = await searchNodeHits(USER, { query: "truman" });
    expect(hits).toEqual([
      expect.objectContaining({
        node: expect.objectContaining({ id: meeting.id }),
        matchedIn: "attachment",
        attachment: expect.objectContaining({ filename: "PSAC agenda.pdf" }),
      }),
    ]);
  });

  it("brief shows attachment previews on recent meetings", async () => {
    await seed();
    const result = await brief(USER, "Art Trembanis");
    if (result?.status !== "ok") throw new Error("expected ok");
    expect(result.recentMeetings[0].attachments).toEqual([
      expect.objectContaining({ filename: "PSAC agenda.pdf", textPreview: "Handout: the Truman scholarship timeline." }),
    ]);
    expect(result.recentMeetings[0].attachments[0]).not.toHaveProperty("r2Key");
  });

  it("who_knows credits attendees of a meeting whose file mentions the query", async () => {
    await seed();
    const result = await whoKnows(USER, "truman");
    expect(result.people).toEqual([
      expect.objectContaining({
        name: "Art Trembanis",
        strength: "mentioned",
        why: ["mentioned in PSAC agenda.pdf from 2026-10-14 · PSAC"],
      }),
    ]);
  });
});
