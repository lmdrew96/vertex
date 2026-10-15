"use client";

import { useCallback, useEffect, useState } from "react";
import { Markdown } from "../../Markdown";
import { archiveNodeAction, getNodeDetailAction, type NodeDetail } from "./actions";
import dynamic from "next/dynamic";

// Client-only: keeps heic2any and the upload code out of the edge page's server bundle.
const AttachmentsSection = dynamic(() => import("./AttachmentsSection").then((m) => m.AttachmentsSection), {
  ssr: false,
});
import { NODE_TYPE_COLOR, NODE_TYPE_TEXT } from "./typeColors";

const s = {
  panel: (open: boolean, mobile: boolean) =>
    mobile
      ? {
          position: "fixed" as const,
          top: 0,
          right: 0,
          height: "100vh",
          width: "100%",
          background: "var(--color-white)",
          boxShadow: "-4px 0px 16px rgba(0,0,0,0.08)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          overflowY: "auto" as const,
          zIndex: 30,
          display: "flex",
          flexDirection: "column" as const,
        }
      : {
          position: "relative" as const,
          height: "100vh",
          // Width change is instant (no transition) so the canvas reflows
          // immediately — only the inner content slides, via innerWrap below.
          width: open ? 400 : 0,
          flexShrink: 0,
          background: "var(--color-white)",
          borderLeft: open ? "1.5px solid var(--color-lavender)" : "none",
          boxShadow: open ? "-4px 0px 16px rgba(0,0,0,0.08)" : "none",
          overflowX: "hidden" as const,
          overflowY: "auto" as const,
          display: "flex",
          flexDirection: "column" as const,
        },
  innerWrap: (open: boolean, mobile: boolean) => ({
    width: mobile ? "100%" : 400,
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    transform: mobile ? undefined : open ? "translateX(0)" : "translateX(100%)",
    transition: mobile ? undefined : "transform 0.2s ease",
  }),
  header: {
    padding: "20px 22px 14px",
    borderBottom: "1.5px solid var(--color-lavender)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  closeBtn: {
    background: "none",
    border: "none",
    fontSize: 18,
    color: "var(--color-teal-deep)",
    cursor: "pointer",
    lineHeight: 1,
    padding: 4,
  },
  name: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 600,
    color: "var(--color-ink)",
    margin: "0 0 6px 0",
    overflowWrap: "anywhere" as const,
  },
  headerMeta: { display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 8 },
  badge: (color: string, text: string) => ({
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: text,
    background: color,
    borderRadius: 9999,
    padding: "3px 10px",
    display: "inline-block",
  }),
  lastMet: { fontFamily: "var(--font-body)", fontSize: 12, color: "var(--color-teal-deep)", opacity: 0.8 },
  body: { padding: "18px 22px", flex: 1 },
  section: { marginBottom: 22 },
  sectionLabel: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 600,
    color: "var(--color-teal-deep)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    opacity: 0.7,
    margin: "0 0 8px 0",
  },
  fields: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "6px 14px",
    fontFamily: "var(--font-body)",
    fontSize: 13.5,
    margin: "0 0 18px",
  },
  fieldKey: { color: "var(--color-teal-deep)", opacity: 0.75 },
  fieldVal: { color: "var(--color-ink)", overflowWrap: "anywhere" as const, margin: 0 },
  chipRow: { display: "flex", flexWrap: "wrap" as const, gap: 6 },
  tag: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "3px 9px",
    borderRadius: 9999,
    background: "var(--color-surface)",
    color: "var(--color-teal-deep)",
    border: "1px solid var(--color-lavender)",
  },
  nodeChip: (color: string) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    padding: "5px 11px",
    borderRadius: 9999,
    border: `1.5px solid ${color}`,
    background: "var(--color-white)",
    color: "var(--color-ink)",
    cursor: "pointer",
  }),
  ccChip: {
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    padding: "3px 9px",
    borderRadius: 9999,
    background: "var(--color-surface)",
    border: "1px solid var(--color-lavender)",
    color: "var(--color-teal-deep)",
  },
  card: {
    padding: "9px 11px",
    borderRadius: 8,
    background: "var(--color-surface)",
    marginBottom: 6,
    cursor: "pointer",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    border: "none",
    width: "100%",
    textAlign: "left" as const,
    display: "block",
    color: "var(--color-ink)",
  },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" },
  cardDate: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-teal-deep)", whiteSpace: "nowrap" as const },
  cardSub: { fontSize: 12, color: "var(--color-teal-deep)", opacity: 0.8, marginTop: 3 },
  excerpt: { marginTop: 6, fontSize: 12.5 },
  empty: { fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--color-teal-deep)", opacity: 0.7, margin: 0 },
  footer: { padding: "16px 22px", borderTop: "1.5px solid var(--color-lavender)" },
  archiveBtn: {
    fontFamily: "var(--font-body)",
    background: "none",
    border: "1.5px solid var(--color-danger)",
    color: "var(--color-danger)",
    borderRadius: 9999,
    padding: "9px 18px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    width: "100%",
  },
  loading: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-teal-deep)", padding: 22 },
};

// "2026-10-14" → "Wed, Oct 14, 2026". Built from parts so it's the local calendar day, never shifted by UTC.
const formatDate = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

type DetailPanelProps = {
  userId: string;
  nodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onArchived: (nodeId: string) => void;
  onClose: () => void;
  isMobile: boolean;
};

export function DetailPanel({ userId, nodeId, onSelectNode, onArchived, onClose, isMobile }: DetailPanelProps) {
  const [data, setData] = useState<NodeDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!nodeId) {
      setData(null);
      return;
    }
    try {
      setError("");
      setData(await getNodeDetailAction(userId, nodeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this node.");
    }
  }, [userId, nodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleArchive = async () => {
    if (!data) return;
    const node = data.brief.node;
    if (!window.confirm(`Archive "${node.name}"? This can't be undone from the UI.`)) return;
    await archiveNodeAction(userId, node.id);
    onArchived(node.id);
  };

  // Driven by nodeId (not data) so the layout reserves space in the same
  // render as GraphCanvas kicks off its fetch — avoids a race where the
  // canvas fits its view against a container that's about to shrink.
  const open = Boolean(nodeId);
  const b = data?.brief;
  const node = b?.node;
  // Stale data from the previous selection shouldn't flash while the next one loads.
  const current = node && node.id === nodeId ? b : null;

  const fieldRows: Array<[string, React.ReactNode]> = [];
  if (node?.type === "person" && node.fields) {
    const f = node.fields;
    if (f.role) fieldRows.push(["Role", f.role]);
    if (f.affiliation) fieldRows.push(["Affiliation", f.affiliation]);
    if (f.email) fieldRows.push(["Email", <a key="e" href={`mailto:${f.email}`}>{f.email}</a>]);
    if (f.howWeMet) fieldRows.push(["How we met", f.howWeMet]);
  }
  if (node?.type === "group" && node.fields) {
    if (node.fields.kind) fieldRows.push(["Kind", node.fields.kind]);
    if (node.fields.url) {
      fieldRows.push([
        "Link",
        <a key="u" href={node.fields.url} target="_blank" rel="noopener noreferrer">
          {node.fields.url}
        </a>,
      ]);
    }
  }
  if (node?.type === "meeting") {
    fieldRows.push(["Date", formatDate(node.fields.date)]);
    if (node.fields.kind === "event") fieldRows.push(["Kind", "Event"]);
  }

  return (
    <div style={s.panel(open, isMobile)}>
      {open && !current && <p style={s.loading}>{error || "Loading…"}</p>}
      {current && node && (
        <div style={s.innerWrap(open, isMobile)}>
          <div style={s.header}>
            <div style={{ minWidth: 0 }}>
              <p style={s.name}>{node.name}</p>
              <div style={s.headerMeta}>
                <span style={s.badge(NODE_TYPE_COLOR[node.type], NODE_TYPE_TEXT[node.type])}>{node.type}</span>
                {node.type !== "meeting" && current.lastContact && (
                  <span style={s.lastMet}>Last met {formatDate(current.lastContact)}</span>
                )}
                {node.type === "meeting" && node.fields.ccEventId && (
                  <span style={s.ccChip} title="Linked ControlledChaos event">
                    CC event · {node.fields.ccEventId}
                  </span>
                )}
              </div>
            </div>
            <button style={s.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div style={s.body}>
            {fieldRows.length > 0 && (
              <dl style={s.fields}>
                {fieldRows.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={s.fieldKey}>{k}</dt>
                    <dd style={s.fieldVal}>{v}</dd>
                  </div>
                ))}
              </dl>
            )}

            {node.description && (
              <div style={s.section}>
                <Markdown>{node.description}</Markdown>
              </div>
            )}

            {node.type === "meeting" && (
              <div style={s.section}>
                <p style={s.sectionLabel}>Notes</p>
                {node.fields.notes ? <Markdown>{node.fields.notes}</Markdown> : <p style={s.empty}>No notes.</p>}
                {current.openFollowUps.length > 0 && (
                  <p style={{ ...s.empty, marginTop: 8 }}>
                    {current.openFollowUps.length} follow-up task
                    {current.openFollowUps.length === 1 ? "" : "s"} in ControlledChaos
                  </p>
                )}
              </div>
            )}

            {node.type !== "meeting" && (
              <div style={s.section}>
                <p style={s.sectionLabel}>Meetings & events ({current.recentMeetings.length})</p>
                {current.recentMeetings.length === 0 && <p style={s.empty}>No meetings or events yet.</p>}
                {current.recentMeetings.map((m) => (
                  <button key={m.id} type="button" style={s.card} onClick={() => onSelectNode(m.id)}>
                    <div style={s.cardTop}>
                      <strong>{m.name}</strong>
                      <span style={s.cardDate}>{formatDate(m.date)}</span>
                    </div>
                    {m.notesExcerpt && (
                      <div style={s.excerpt}>
                        <Markdown>{m.notesExcerpt}</Markdown>
                      </div>
                    )}
                    {m.attachments.length > 0 && (
                      <div style={s.cardSub}>
                        {m.attachments.length} file{m.attachments.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div style={s.section}>
              <p style={s.sectionLabel}>
                {node.type === "meeting" ? "Attendees" : "People"} ({current.people.length})
              </p>
              {current.people.length === 0 && <p style={s.empty}>Nobody linked yet.</p>}
              {current.people.map((p) => (
                <button key={p.id} type="button" style={s.card} onClick={() => onSelectNode(p.id)}>
                  <strong>{p.name}</strong>
                  {(p.role || p.affiliation) && (
                    <div style={s.cardSub}>{[p.role, p.affiliation].filter(Boolean).join(" · ")}</div>
                  )}
                  {node.type !== "meeting" && <div style={s.cardSub}>{p.links.join(" · ")}</div>}
                </button>
              ))}
            </div>

            {current.groups.length > 0 && (
              <div style={s.section}>
                <p style={s.sectionLabel}>{node.type === "meeting" ? "Group" : "Groups"}</p>
                <div style={s.chipRow}>
                  {current.groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      style={s.nodeChip(NODE_TYPE_COLOR.group)}
                      onClick={() => onSelectNode(g.id)}
                      title={g.links.join("\n")}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {current.topics.length > 0 && (
              <div style={s.section}>
                <p style={s.sectionLabel}>Topics</p>
                <div style={s.chipRow}>
                  {current.topics.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      style={s.nodeChip(NODE_TYPE_COLOR.topic)}
                      onClick={() => onSelectNode(t.id)}
                      title={t.links.join("\n")}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {node.tags.length > 0 && (
              <div style={s.section}>
                <p style={s.sectionLabel}>Tags</p>
                <div style={s.chipRow}>
                  {node.tags.map((tag) => (
                    <span key={tag} style={s.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={s.section}>
              <p style={s.sectionLabel}>Files ({data!.attachments.length})</p>
              <AttachmentsSection
                token={userId}
                nodeId={node.id}
                attachments={data!.attachments}
                loadError={data!.attachmentsError}
                mobile={isMobile}
                onChanged={() => void load()}
              />
            </div>
          </div>

          <div style={s.footer}>
            <button style={s.archiveBtn} onClick={handleArchive}>
              Archive node
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
