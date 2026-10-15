"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dashboard as DashboardData } from "@/lib/dashboard";
import type { VertexNode } from "@/lib/types";
import { getDashboardAction, searchNodesAction } from "./[userId]/graph/actions";
import { MeetingForm } from "./[userId]/graph/MeetingForm";
import { NODE_TYPE_COLOR, NODE_TYPE_LABEL } from "./[userId]/graph/typeColors";
import { AppNav } from "./AppNav";

const SEARCH_LIMIT = 8;

const s = {
  page: {
    minHeight: "100vh",
    background: "var(--color-surface)",
    padding: "20px 24px 32px",
    boxSizing: "border-box" as const,
  },
  header: {
    maxWidth: 1080,
    margin: "0 auto 20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap" as const,
  },
  h1: { fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 600, color: "var(--color-ink)", margin: 0 },
  // Two columns on desktop; auto-fit stacks them on narrow screens.
  grid: {
    maxWidth: 1080,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    gap: 20,
    alignItems: "start",
  },
  card: {
    background: "var(--color-white)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 20,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
    minWidth: 0,
  },
  h2: { fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--color-ink)", margin: 0 },
  label: {
    fontFamily: "var(--font-body)",
    fontSize: 11,
    fontWeight: 500,
    color: "var(--color-teal-deep)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    opacity: 0.7,
    margin: 0,
  },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" as const },
  primaryBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    color: "var(--color-on-light)",
    border: "none",
    borderRadius: 9999,
    padding: "9px 18px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    textDecoration: "none",
  },
  secondaryBtn: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    color: "var(--color-ink)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 9999,
    padding: "8px 16px",
    fontWeight: 500,
    fontSize: 14,
    cursor: "pointer",
    textDecoration: "none",
  },
  input: {
    fontFamily: "var(--font-body)",
    background: "var(--color-surface)",
    border: "1.5px solid var(--color-lavender)",
    borderRadius: 8,
    color: "var(--color-ink)",
    fontSize: 14,
    padding: "9px 11px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  formWrap: { border: "1.5px solid var(--color-lavender)", borderRadius: 14, paddingTop: 14, marginLeft: -4, marginRight: -4 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" as const, gap: 6 },
  row: {
    display: "block",
    textDecoration: "none",
    color: "var(--color-ink)",
    padding: "9px 11px",
    borderRadius: 10,
    border: "1.5px solid var(--color-lavender)",
    background: "var(--color-surface)",
  },
  rowTop: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" as const },
  rowName: { fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600 },
  meta: { fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--color-teal-deep)" },
  chips: { display: "flex", flexWrap: "wrap" as const, gap: 5, marginTop: 6 },
  chip: (color: string) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12,
    padding: "2px 9px",
    borderRadius: 9999,
    border: `1.5px solid ${color}`,
    color: "var(--color-ink)",
  }),
  dot: (color: string) => ({
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: 9999,
    background: color,
    flexShrink: 0,
  }),
  empty: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-teal-deep)", margin: 0, opacity: 0.8 },
  error: { fontFamily: "var(--font-body)", fontSize: 13, color: "var(--color-danger)", margin: 0 },
};

// "2026-10-13" → "Tue, Oct 13". Built from parts so it's the local calendar day, never shifted by UTC.
const formatDate = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VertexNode[]>([]);

  const graphHref = `/${token}/graph`;
  const focusHref = (nodeId: string) => `${graphHref}?node=${encodeURIComponent(nodeId)}`;

  const load = useCallback(async () => {
    try {
      const result = await getDashboardAction(token);
      if (!result.ok) return setError(result.error);
      setData(result.value);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your dashboard.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        setResults((await searchNodesAction(token, { query })).slice(0, SEARCH_LIMIT));
      } catch (e) {
        console.error("[vertex] dashboard search failed:", e);
        setError("Search failed. Try again.");
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [token, query]);

  return (
    <main style={s.page}>
      <header style={s.header}>
        <h1 style={s.h1}>Vertex</h1>
        <AppNav token={token} current="dashboard" />
      </header>

      <div style={s.grid}>
        <section style={s.card} aria-labelledby="quick-heading">
          <h2 id="quick-heading" style={s.h2}>
            Quick actions
          </h2>
          <div style={s.actions}>
            <button type="button" style={s.primaryBtn} aria-expanded={logging} onClick={() => setLogging(!logging)}>
              {logging ? "Close" : "Log a meeting"}
            </button>
            <a href={graphHref} style={s.secondaryBtn}>
              Open graph →
            </a>
          </div>

          {logging && (
            <div style={s.formWrap}>
              <MeetingForm
                userId={token}
                nodes={data?.nodes ?? []}
                onLogged={() => {
                  setLogging(false);
                  void load();
                }}
              />
            </div>
          )}

          <input
            style={s.input}
            type="search"
            placeholder="Search people, groups, meetings, topics…"
            aria-label="Search your graph"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && (
            <ul style={s.list}>
              {results.length === 0 && <li style={s.empty}>No matches.</li>}
              {results.map((n) => (
                <li key={n.id}>
                  <a href={focusHref(n.id)} style={s.row}>
                    <span style={s.rowTop}>
                      <span style={s.dot(NODE_TYPE_COLOR[n.type])} />
                      <span style={s.rowName}>{n.name}</span>
                      <span style={s.meta}>{NODE_TYPE_LABEL[n.type]}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}

          <p style={s.label}>Recent meetings</p>
          {!data && !error && <p style={s.empty}>Loading…</p>}
          {data && data.recentMeetings.length === 0 && <p style={s.empty}>No meetings yet. Log one above.</p>}
          {data && data.recentMeetings.length > 0 && (
            <ul style={s.list}>
              {data.recentMeetings.map((m) => (
                <li key={m.id}>
                  <a href={focusHref(m.id)} style={s.row}>
                    <span style={s.rowTop}>
                      <span style={s.meta}>{formatDate(m.date)}</span>
                      <span style={s.rowName}>{m.name}</span>
                      {m.kind === "event" && <span style={s.meta}>event</span>}
                    </span>
                    {(m.group || m.attendees.length > 0) && (
                      <span style={s.chips}>
                        {m.group && <span style={s.chip(NODE_TYPE_COLOR.group)}>{m.group.name}</span>}
                        {m.attendees.map((p) => (
                          <span key={p.id} style={s.chip(NODE_TYPE_COLOR.person)}>
                            {p.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" style={s.error}>
              {error}
            </p>
          )}
        </section>

        <section style={s.card} aria-labelledby="threads-heading">
          <h2 id="threads-heading" style={s.h2}>
            Your threads
          </h2>
          {!data && !error && <p style={s.empty}>Loading…</p>}
          {data && data.threads.length === 0 && <p style={s.empty}>Threads appear when a meeting is about a topic.</p>}
          {data && data.threads.length > 0 && (
            <ul style={s.list}>
              {data.threads.map((t) => (
                <li key={t.id}>
                  <a href={focusHref(t.id)} style={s.row}>
                    <span style={s.rowTop}>
                      <span style={s.dot(NODE_TYPE_COLOR.topic)} />
                      <span style={s.rowName}>{t.name}</span>
                    </span>
                    <span style={{ ...s.meta, display: "block", marginTop: 4 }}>
                      {t.peopleCount} {t.peopleCount === 1 ? "person" : "people"} ·{" "}
                      {plural(t.meetingCount, "meeting")} · last {formatDate(t.lastMeetingDate)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
