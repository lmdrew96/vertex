"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AttachmentView } from "@/lib/attachments";
import type { ExtractStatus } from "@/lib/types";
import { Markdown } from "../../Markdown";
import { deleteAttachmentAction } from "./actions";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

// Browsers often send no type (or an odd one) for .md/.docx, so the extension wins.
const TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  docx: DOCX,
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
};
const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx,.txt,.md,.markdown";

const extOf = (name: string): string => name.split(".").pop()?.toLowerCase() ?? "";
const typeOf = (file: File): string => TYPE_BY_EXT[extOf(file.name)] ?? file.type.toLowerCase();

// HEIC (iPhone default) → JPEG in the browser; the server only takes web formats.
const toUploadable = async (file: File): Promise<{ file: Blob; name: string; type: string }> => {
  const type = typeOf(file);
  if (type !== "image/heic" && type !== "image/heif") return { file, name: file.name, type };
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  return { file: blob, name: file.name.replace(/\.hei[cf]$/i, ".jpg"), type: "image/jpeg" };
};

const post = async (token: string, body: Record<string, unknown>) => {
  const res = await fetch(`/${token}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Upload failed.");
  return data;
};

const uploadFile = async (token: string, nodeId: string, original: File): Promise<void> => {
  const { file, name, type } = await toUploadable(original);
  if (file.size > MAX_BYTES) throw new Error(`${name} is over 10 MB.`);
  const { attachmentId, uploadUrl } = await post(token, {
    action: "request",
    nodeIds: [nodeId],
    filename: name,
    contentType: type,
    size: file.size,
  });
  let put: Response;
  try {
    put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: file });
  } catch {
    // A network-level failure here is almost always the bucket's CORS rule.
    throw new Error(`Couldn't send ${name} to storage. The R2 bucket may need its CORS rule (see CLAUDE.md).`);
  }
  if (!put.ok) throw new Error(`Storage rejected ${name} (${put.status}).`);
  await post(token, { action: "confirm", attachmentId });
};

// ── Status badge ─────────────────────────────────────────────────────────────

const STATUS: Record<ExtractStatus, { label: string; tone: "ok" | "neutral" | "error"; hint: string }> = {
  done: { label: "text", tone: "ok", hint: "Text extracted, so this file is searchable." },
  provided: { label: "text", tone: "ok", hint: "Text added by Coru, so this file is searchable." },
  pending: { label: "reading…", tone: "neutral", hint: "Text extraction hasn't finished." },
  not_transcribed: {
    label: "not transcribed",
    tone: "neutral",
    hint: "No text yet. Coru can read it and add the text.",
  },
  failed: { label: "couldn't read", tone: "error", hint: "Text extraction failed." },
};

const badgeStyle = (tone: "ok" | "neutral" | "error") => ({
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  borderRadius: 9999,
  padding: "2px 8px",
  whiteSpace: "nowrap" as const,
  ...(tone === "ok"
    ? { background: "var(--color-mint)", color: "var(--color-on-light)" }
    : tone === "neutral"
      ? { background: "var(--color-surface)", color: "var(--color-teal-deep)", border: "1px solid var(--color-lavender)" }
      : { background: "transparent", color: "var(--color-danger)", border: "1px solid var(--color-danger)" }),
});

// ── Styles ───────────────────────────────────────────────────────────────────

const s = {
  drop: (active: boolean) => ({
    border: `1.5px dashed ${active ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: active ? "var(--color-surface)" : "transparent",
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    color: "var(--color-teal-deep)",
    marginBottom: 10,
  }),
  addBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-teal-deep)",
    color: "var(--color-white)",
    border: "none",
    borderRadius: 9999,
    padding: "6px 14px",
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  item: {
    border: "1px solid var(--color-lavender)",
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    background: "var(--color-white)",
  },
  row: { display: "flex", gap: 10, alignItems: "center" },
  thumbBtn: {
    width: 52,
    height: 52,
    flexShrink: 0,
    borderRadius: 8,
    border: "1px solid var(--color-lavender)",
    background: "var(--color-surface)",
    padding: 0,
    overflow: "hidden",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-teal-deep)",
  },
  meta: { flex: 1, minWidth: 0 },
  filename: {
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--color-ink)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    textAlign: "left" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    display: "block",
    maxWidth: "100%",
  },
  caption: { fontFamily: "var(--font-body)", fontSize: 12, color: "var(--color-teal-deep)", opacity: 0.8 },
  smallRow: { display: "flex", gap: 8, alignItems: "center", marginTop: 4 },
  textToggle: {
    fontFamily: "var(--font-body)",
    fontSize: 11.5,
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--color-teal-deep)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  deleteBtn: {
    fontFamily: "var(--font-body)",
    fontSize: 11.5,
    background: "none",
    border: "none",
    padding: 0,
    marginLeft: "auto",
    color: "var(--color-danger)",
    cursor: "pointer",
  },
  confirmText: { fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--color-danger)", marginLeft: "auto" },
  textBox: {
    marginTop: 8,
    padding: "10px 12px",
    background: "var(--color-surface)",
    borderRadius: 8,
    maxHeight: 260,
    overflowY: "auto" as const,
  },
  note: { fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-teal-deep)", opacity: 0.75, margin: "0 0 8px" },
  error: { fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-danger)", margin: "0 0 8px" },
};

// ── Viewer modal ─────────────────────────────────────────────────────────────

const v = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(30, 24, 48, 0.65)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  dialog: (mobile: boolean) => ({
    background: "var(--color-white)",
    borderRadius: mobile ? 0 : 16,
    width: mobile ? "100vw" : "min(960px, 100%)",
    height: mobile ? "100dvh" : "min(88vh, 900px)",
    margin: mobile ? -16 : 0,
    display: "flex",
    flexDirection: "column" as const,
    overflow: "hidden",
    boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
  }),
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: "1.5px solid var(--color-lavender)",
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    fontSize: 14,
    color: "var(--color-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    margin: 0,
  },
  link: { fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-teal-deep)" },
  close: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: "var(--color-teal-deep)",
    cursor: "pointer",
    lineHeight: 1,
    padding: 4,
  },
  body: { flex: 1, minHeight: 0, overflow: "auto", background: "var(--color-surface)" },
  img: { display: "block", maxWidth: "100%", maxHeight: "100%", margin: "0 auto", objectFit: "contain" as const },
  frame: { width: "100%", height: "100%", border: "none", display: "block", background: "var(--color-white)" },
  text: { padding: "18px 22px", background: "var(--color-white)", minHeight: "100%" },
};

function AttachmentViewer({
  att,
  mobile,
  onClose,
}: {
  att: AttachmentView;
  mobile: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const isImage = att.contentType.startsWith("image/");
  const isPdf = att.contentType === "application/pdf";
  // Photos and PDFs show the file itself; their extracted text is one click away.
  const [showText, setShowText] = useState(false);
  const canToggle = (isImage || isPdf) && Boolean(att.extractedText);

  // Portaled to <body>: the detail panel's transform would otherwise trap this fixed overlay inside it.
  return createPortal(
    <div style={v.backdrop} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={att.filename}
        style={v.dialog(mobile)}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={v.header}>
          <p style={v.title}>{att.filename}</p>
          {canToggle && (
            <button type="button" style={{ ...s.textToggle, fontSize: 12.5 }} onClick={() => setShowText((x) => !x)}>
              {showText ? "File" : "Text"}
            </button>
          )}
          <a href={att.url} download={att.filename} style={v.link}>
            Download
          </a>
          <button ref={closeRef} style={v.close} onClick={onClose} aria-label="Close viewer">
            ✕
          </button>
        </div>
        <div style={v.body}>
          {showText && att.extractedText ? (
            <div style={v.text}>
              <Markdown>{att.extractedText}</Markdown>
            </div>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL, not optimizable
            <img src={att.url} alt={att.caption ?? att.filename} style={v.img} />
          ) : isPdf ? (
            <iframe src={att.url} title={att.filename} style={v.frame} />
          ) : (
            <div style={v.text}>
              {att.extractedText ? (
                <Markdown>{att.extractedText}</Markdown>
              ) : (
                <p style={s.note}>No preview for this file yet. Use Download to open it.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

export function AttachmentsSection({
  token,
  nodeId,
  attachments,
  loadError,
  mobile,
  onChanged,
}: {
  token: string;
  nodeId: string;
  attachments: AttachmentView[];
  loadError?: string;
  mobile: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [openText, setOpenText] = useState<Set<string>>(new Set());
  const [viewing, setViewing] = useState<AttachmentView | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const remove = async (att: AttachmentView) => {
    setError("");
    setDeleting(att.id);
    try {
      const result = await deleteAttachmentAction(token, att.id);
      if (!result.ok) setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't delete ${att.filename}.`);
    }
    setDeleting(null);
    setConfirmingDelete(null);
    onChanged();
  };

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError("");
    const failures: string[] = [];
    for (const [i, f] of list.entries()) {
      setBusy(list.length > 1 ? `Uploading ${i + 1} of ${list.length}…` : `Uploading ${f.name}…`);
      try {
        await uploadFile(token, nodeId, f);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : `${f.name} failed.`);
      }
    }
    setBusy("");
    if (failures.length > 0) setError(failures.join(" "));
    onChanged();
  };

  const toggleText = (id: string) =>
    setOpenText((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div
        style={s.drop(dragging)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <span>{busy || (mobile ? "Photos, PDFs, docs, notes" : "Drop files here: photos, PDFs, docs, notes")}</span>
        <button type="button" style={s.addBtn} onClick={() => inputRef.current?.click()} disabled={Boolean(busy)}>
          Add file
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {loadError && <p style={s.note}>{loadError}</p>}
      {error && <p style={s.error}>{error}</p>}
      {attachments.length === 0 && !loadError && <p style={s.note}>No files yet.</p>}

      {attachments.map((att) => {
        const status = STATUS[att.extractStatus];
        const isImage = att.contentType.startsWith("image/");
        const textOpen = openText.has(att.id);
        return (
          <div key={att.id} style={s.item}>
            <div style={s.row}>
              <button
                type="button"
                style={s.thumbBtn}
                onClick={() => setViewing(att)}
                aria-label={`View ${att.filename}`}
              >
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                  <img src={att.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  extOf(att.filename).toUpperCase().slice(0, 4) || "FILE"
                )}
              </button>
              <div style={s.meta}>
                <button type="button" style={s.filename} onClick={() => setViewing(att)} title={att.filename}>
                  {att.filename}
                </button>
                {att.caption && <div style={s.caption}>{att.caption}</div>}
                <div style={s.smallRow}>
                  <span
                    style={badgeStyle(status.tone)}
                    title={att.extractStatus === "failed" && att.extractError ? att.extractError : status.hint}
                  >
                    {status.label}
                  </span>
                  {att.extractedText && (
                    <button type="button" style={s.textToggle} onClick={() => toggleText(att.id)}>
                      {textOpen ? "Hide text" : "Text"}
                    </button>
                  )}
                  {deleting === att.id ? (
                    <span style={s.confirmText}>Deleting…</span>
                  ) : confirmingDelete === att.id ? (
                    <span style={s.confirmText}>
                      {att.nodeIds.length > 1 ? `Delete from all ${att.nodeIds.length} nodes? ` : "Delete for good? "}
                      <button type="button" style={{ ...s.textToggle, color: "var(--color-danger)" }} onClick={() => void remove(att)}>
                        Yes
                      </button>{" "}
                      <button type="button" style={s.textToggle} onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      style={s.deleteBtn}
                      onClick={() => setConfirmingDelete(att.id)}
                      aria-label={`Delete ${att.filename}`}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
            {textOpen && att.extractedText && (
              <div style={s.textBox}>
                <Markdown>{att.extractedText}</Markdown>
              </div>
            )}
          </div>
        );
      })}

      {viewing && <AttachmentViewer att={viewing} mobile={mobile} onClose={closeViewer} />}
    </div>
  );
}
