import { redis } from "./redis";
import { allAttsKey, attKey, nodeAttsKey, nodeKey, pendingUploadKey } from "./keys";
import { deleteObject, headObject, presignGetUrl, presignPutUrl } from "./r2";
import type { Attachment } from "./types";

// ── Rules ────────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // same as ChaosPatch
export const MAX_EXTRACTED_CHARS = 50_000;
const PREVIEW_CHARS = 200;
const UPLOAD_URL_SECONDS = 15 * 60;
const PENDING_TTL_SECONDS = 60 * 60;

export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];
const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

type PendingUpload = Omit<Attachment, "extractStatus" | "extractedText" | "extractError">;

export type AttachmentSummary = Omit<Attachment, "extractedText" | "r2Key"> & {
  textPreview?: string;
};

export const summarize = (att: Attachment): AttachmentSummary => {
  const { extractedText, r2Key: _r2Key, ...meta } = att;
  if (!extractedText) return meta;
  const flat = extractedText.replace(/\s+/g, " ").trim();
  return {
    ...meta,
    textPreview: flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat,
  };
};

// Keep a readable name in the object key without letting a filename shape the path.
export const safeFilename = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|-+$/g, "")
    .slice(0, 100);
  return cleaned || "file";
};

export const truncateExtracted = (text: string): string =>
  text.length > MAX_EXTRACTED_CHARS ? text.slice(0, MAX_EXTRACTED_CHARS) : text;

const assertNodesExist = async (userId: string, nodeIds: string[]): Promise<void> => {
  const found = await Promise.all(nodeIds.map((id) => redis.get(nodeKey(userId, id))));
  const missing = nodeIds.filter((_, i) => !found[i]);
  if (missing.length > 0) {
    throw new Error(
      `Node${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}. Pass exact node IDs (use vtx_node_search to find them).`,
    );
  }
};

// ── Upload flow ──────────────────────────────────────────────────────────────

export const requestUpload = async (
  userId: string,
  input: { nodeIds: string[]; filename: string; contentType: string; size: number; caption?: string },
): Promise<{ attachmentId: string; uploadUrl: string; expiresAt: string; contentType: string }> => {
  const nodeIds = [...new Set(input.nodeIds.map((n) => n.trim()).filter(Boolean))];
  if (nodeIds.length === 0) throw new Error("node_ids needs at least one node.");
  const contentType = input.contentType.trim().toLowerCase();
  if (HEIC_TYPES.includes(contentType)) {
    throw new Error("HEIC/HEIF photos aren't accepted. Convert the photo to JPEG first, then upload that.");
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    throw new Error(`Unsupported file type '${input.contentType}'. Allowed: ${ALLOWED_TYPES.join(", ")}.`);
  }
  if (!Number.isInteger(input.size) || input.size <= 0) throw new Error("size must be the file's size in bytes.");
  if (input.size > MAX_UPLOAD_BYTES) throw new Error("Files can be at most 10 MB.");
  const filename = input.filename.trim();
  if (!filename) throw new Error("filename is required.");
  await assertNodesExist(userId, nodeIds);

  const id = crypto.randomUUID();
  const pending: PendingUpload = {
    id,
    nodeIds,
    filename,
    contentType,
    size: input.size,
    r2Key: `vertex/${userId}/${id}/${safeFilename(filename)}`,
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  const uploadUrl = await presignPutUrl(pending.r2Key, contentType, UPLOAD_URL_SECONDS);
  await redis.set(pendingUploadKey(userId, id), pending, { ex: PENDING_TTL_SECONDS });
  return {
    attachmentId: id,
    uploadUrl,
    expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
    contentType,
  };
};

/**
 * Confirm a finished upload. Type and size come from a HEAD on the stored object, never
 * the client; anything off gets deleted. With `extractedText` (Coru already read the
 * file), it's saved as "provided"; otherwise it's saved as "pending" and the caller runs
 * extraction (confirmAndExtract in lib/extract.ts), which keeps the PDF/AI libraries out of
 * every bundle that only reads attachments.
 */
export const confirmUpload = async (
  userId: string,
  attachmentId: string,
  extractedText?: string,
): Promise<Attachment> => {
  const existing = await getAttachment(userId, attachmentId);
  if (existing) return existing; // already confirmed — confirming twice is harmless

  const pending = await redis.get<PendingUpload>(pendingUploadKey(userId, attachmentId));
  if (!pending) {
    throw new Error("Unknown or expired upload. Request a new one with vtx_attachment_request_upload.");
  }

  const head = await headObject(pending.r2Key);
  if (!head) {
    throw new Error(
      `No file at the upload URL yet. PUT the bytes there with header "Content-Type: ${pending.contentType}", then confirm again.`,
    );
  }
  if ((head.size ?? 0) > MAX_UPLOAD_BYTES || head.contentType !== pending.contentType) {
    await deleteObject(pending.r2Key);
    await redis.del(pendingUploadKey(userId, attachmentId));
    throw new Error("The uploaded file didn't match the request (type or size over 10 MB), so it was discarded.");
  }

  const text = extractedText?.trim();
  const att: Attachment = {
    ...pending,
    size: head.size ?? pending.size,
    ...(text ? { extractedText: truncateExtracted(text) } : {}),
    extractStatus: text ? "provided" : "pending",
  };
  await Promise.all([
    redis.set(attKey(userId, att.id), att),
    redis.sadd(allAttsKey(userId), att.id),
    ...att.nodeIds.map((n) => redis.sadd(nodeAttsKey(userId, n), att.id)),
  ]);
  await redis.del(pendingUploadKey(userId, attachmentId));
  return att;
};

// ── Read / link / delete ─────────────────────────────────────────────────────

export const getAttachment = async (userId: string, attachmentId: string): Promise<Attachment | null> =>
  (await redis.get<Attachment>(attKey(userId, attachmentId))) ?? null;

export const getAttachmentWithUrl = async (
  userId: string,
  attachmentId: string,
): Promise<(Attachment & { downloadUrl: string; downloadExpiresAt: string }) | null> => {
  const att = await getAttachment(userId, attachmentId);
  if (!att) return null;
  const seconds = 60 * 60;
  return {
    ...att,
    downloadUrl: await presignGetUrl(att.r2Key, seconds),
    downloadExpiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  };
};

const byNewest = (a: Attachment, b: Attachment): number => b.createdAt.localeCompare(a.createdAt);

export const listNodeAttachments = async (userId: string, nodeId: string): Promise<Attachment[]> => {
  const ids = (await redis.smembers(nodeAttsKey(userId, nodeId))) as string[];
  const atts = await Promise.all(ids.map((id) => getAttachment(userId, id)));
  return atts.filter((a): a is Attachment => a !== null).sort(byNewest);
};

export const listAllAttachments = async (userId: string): Promise<Attachment[]> => {
  const ids = (await redis.smembers(allAttsKey(userId))) as string[];
  const atts = await Promise.all(ids.map((id) => getAttachment(userId, id)));
  return atts.filter((a): a is Attachment => a !== null);
};

export const linkAttachment = async (
  userId: string,
  attachmentId: string,
  change: { add?: string[]; remove?: string[] },
): Promise<Attachment> => {
  const att = await getAttachment(userId, attachmentId);
  if (!att) throw new Error(`Attachment '${attachmentId}' not found.`);
  const add = [...new Set(change.add ?? [])].filter((n) => !att.nodeIds.includes(n));
  const remove = new Set(change.remove ?? []);
  await assertNodesExist(userId, add);

  const nodeIds = [...att.nodeIds.filter((n) => !remove.has(n)), ...add];
  if (nodeIds.length === 0) {
    throw new Error("A file has to stay on at least one node. Delete it with vtx_attachment_delete instead.");
  }
  const removed = att.nodeIds.filter((n) => remove.has(n));
  const next: Attachment = { ...att, nodeIds };
  await Promise.all([
    redis.set(attKey(userId, att.id), next),
    ...add.map((n) => redis.sadd(nodeAttsKey(userId, n), att.id)),
    ...removed.map((n) => redis.srem(nodeAttsKey(userId, n), att.id)),
  ]);
  return next;
};

/** R2 object first, so a storage failure never leaves an orphaned file with no record. */
export const deleteAttachment = async (userId: string, attachmentId: string): Promise<Attachment | null> => {
  const att = await getAttachment(userId, attachmentId);
  if (!att) return null;
  await deleteObject(att.r2Key);
  await Promise.all([
    redis.del(attKey(userId, att.id)),
    redis.srem(allAttsKey(userId), att.id),
    ...att.nodeIds.map((n) => redis.srem(nodeAttsKey(userId, n), att.id)),
  ]);
  return att;
};
