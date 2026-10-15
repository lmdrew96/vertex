import Anthropic from "@anthropic-ai/sdk";
import { unzipSync } from "fflate";
import { extractText, getDocumentProxy } from "unpdf";
import { confirmUpload, getAttachment, truncateExtracted } from "./attachments";
import { attKey } from "./keys";
import { getObjectBytes } from "./r2";
import { redis } from "./redis";
import type { Attachment } from "./types";

/**
 * Server-side text extraction for attachments uploaded without text. Everything here is
 * edge/Workers-safe: unpdf (serverless PDF.js), fflate (pure-JS unzip), and the Anthropic
 * SDK (fetch-based).
 */

// The app's one model setting. Transcription is cheap, literal work.
export const EXTRACTION_MODEL = "claude-haiku-5-5";

const TRANSCRIBE_PROMPT = [
  "Transcribe all of the text in this file exactly as written, including handwriting.",
  "Keep the original reading order and line breaks. Do not summarize, correct, translate, or add commentary.",
  'After the transcription, add one final line that starts with "[Non-text content:" and briefly describes any photos, diagrams, or drawings, or says "[Non-text content: none]".',
].join("\n");

// Claude API limit is 10 MB per image after base64 encoding.
const MAX_IMAGE_BASE64_CHARS = 10 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Chunked so large files don't overflow String.fromCharCode's argument limit. No Buffer on edge.
const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/**
 * DOCX is a zip; the body text lives in word/document.xml. Each paragraph becomes a markdown
 * block so the viewer keeps the structure: Heading styles → "#", list paragraphs (numPr or a
 * List* style) → "- " indented by level, everything else → its own paragraph.
 */
export const docxText = (bytes: Uint8Array): string => {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("This .docx has no word/document.xml, so it may be damaged.");
  const blocks: { text: string; list: boolean }[] = [];
  for (const [para] of new TextDecoder().decode(xml).matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const text = decodeEntities(
      para
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:(br|cr)\/>/g, "  \n")
        .replace(/<[^>]+>/g, ""),
    ).trim();
    if (!text) continue;
    const style = para.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const heading = style.match(/^Heading(\d)$/i);
    if (heading) {
      blocks.push({ text: `${"#".repeat(Math.min(Number(heading[1]), 6))} ${text}`, list: false });
    } else if (para.includes("<w:numPr>") || /^List/i.test(style)) {
      const level = Number(para.match(/<w:ilvl w:val="(\d+)"/)?.[1] ?? 0);
      blocks.push({ text: `${"  ".repeat(level)}- ${text}`, list: true });
    } else {
      blocks.push({ text, list: false });
    }
  }
  // List items stay on consecutive lines (one list); every other block gets a blank line.
  return blocks
    .map((b, i) => (i === 0 ? "" : b.list && blocks[i - 1].list ? "\n" : "\n\n") + b.text)
    .join("");
};

const pdfText = async (bytes: Uint8Array): Promise<string> => {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
};

/** Thrown when a file needs transcription but the server has no model key. Not a failure. */
export class NotTranscribedError extends Error {
  constructor() {
    super("Not transcribed: this server has no ANTHROPIC_API_KEY. Add the text with vtx_attachment_set_text.");
  }
}

/** One Claude call that transcribes an image or a scanned (no text layer) PDF. */
const transcribe = async (bytes: Uint8Array, contentType: ImageType | "application/pdf"): Promise<string> => {
  if (!process.env.ANTHROPIC_API_KEY) throw new NotTranscribedError();
  const data = toBase64(bytes);
  if (contentType !== "application/pdf" && data.length > MAX_IMAGE_BASE64_CHARS) {
    throw new Error(
      "This photo is too large to transcribe (over about 7.5 MB). Upload a smaller version, or pass extracted_text.",
    );
  }
  const file: Anthropic.ContentBlockParam =
    contentType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: contentType, data } };

  const client = new Anthropic();
  const response = await client.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: [file, { type: "text", text: TRANSCRIBE_PROMPT }] }],
  });

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    throw new Error(`The model declined to transcribe this file${category ? ` (${category})` : ""}.`);
  }
  return response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
};

/** Text for a stored file, by type. Throws with a readable message on failure. */
export const extractFileText = async (bytes: Uint8Array, contentType: string): Promise<string> => {
  switch (contentType) {
    case "text/plain":
    case "text/markdown":
      return new TextDecoder().decode(bytes).trim();
    case DOCX_TYPE:
      return docxText(bytes);
    case "application/pdf": {
      const text = await pdfText(bytes);
      // No text layer means a scan: hand the PDF to the model to read.
      return text || transcribe(bytes, "application/pdf");
    }
    default:
      if ((IMAGE_TYPES as readonly string[]).includes(contentType)) {
        return transcribe(bytes, contentType as ImageType);
      }
      throw new Error(`No text extractor for ${contentType}.`);
  }
};

/** A readable reason for the record, keeping the API's status code when there is one. */
export const describeExtractError = (e: unknown): string => {
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status ?? ""}: ${e.message}`.trim();
  return e instanceof Error ? e.message : "Extraction failed.";
};

// ── Attachment extraction (only the MCP route imports this) ─────────────────

/**
 * Pull the stored file and extract its text. Never throws: a failure is recorded as
 * extractStatus "failed" with the reason, and the attachment itself stays.
 */
const runExtraction = async (userId: string, att: Attachment): Promise<Attachment> => {
  let next: Attachment;
  try {
    const text = await extractFileText(await getObjectBytes(att.r2Key), att.contentType);
    const { extractError: _old, ...rest } = att;
    next = { ...rest, ...(text ? { extractedText: truncateExtracted(text) } : {}), extractStatus: "done" };
  } catch (e) {
    const { extractError: _old, ...rest } = att;
    if (e instanceof NotTranscribedError) {
      next = { ...rest, extractStatus: "not_transcribed" };
    } else {
      console.error(`[vertex] extraction failed for attachment ${att.id}:`, e);
      next = { ...att, extractStatus: "failed", extractError: describeExtractError(e) };
    }
  }
  await redis.set(attKey(userId, att.id), next);
  return next;
};

/** Confirm an upload, then extract its text unless it was provided. */
export const confirmAndExtract = async (
  userId: string,
  attachmentId: string,
  extractedText?: string,
): Promise<Attachment> => {
  const att = await confirmUpload(userId, attachmentId, extractedText);
  return att.extractStatus === "pending" ? runExtraction(userId, att) : att;
};

/** Re-run extraction (e.g. after a failure). Text Coru provided is never overwritten. */
export const extractAttachment = async (userId: string, attachmentId: string): Promise<Attachment> => {
  const att = await getAttachment(userId, attachmentId);
  if (!att) throw new Error(`Attachment '${attachmentId}' not found.`);
  if (att.extractStatus === "provided") {
    throw new Error("This file's text was provided when it was uploaded, so there's nothing to extract.");
  }
  return runExtraction(userId, att);
};
