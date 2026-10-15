"use client";

import { useState } from "react";
import type { MeetingChoice } from "@/lib/meetings";
import type { MeetingKind, VertexNode } from "@/lib/types";
import { logMeetingAction } from "./actions";
import { NODE_TYPE_COLOR } from "./typeColors";

// Local calendar date, YYYY-MM-DD. Never toISOString(), which is UTC and can be tomorrow.
const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const s = {
  form: { padding: "0 18px 18px", display: "flex", flexDirection: "column" as const, gap: 10, maxWidth: 520 },
  label: { margin: "4px 0 -4px" },
  row: { display: "flex", gap: 10, flexWrap: "wrap" as const },
  chips: { display: "flex", flexWrap: "wrap" as const, gap: 6 },
  // Square name tag; the left bar carries the node type color.
  chip: (color: string) => ({
    fontFamily: "var(--font-body)",
    fontSize: 13,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 4px 3px 9px",
    background: "var(--inset)",
    borderLeft: `4px solid ${color}`,
  }),
  chipX: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--foreground)",
    fontSize: 13,
    lineHeight: 1,
    padding: "2px 5px",
  },
  choiceBox: {
    border: "1.5px solid var(--caution-amber)",
    borderRadius: "var(--radius)",
    padding: "12px 14px",
    background: "var(--inset)",
    fontFamily: "var(--font-body)",
    fontSize: 13.5,
  },
};

/** Type a name, press Enter (or comma) to add it. Suggestions come from existing nodes. */
function ChipInput({
  id,
  values,
  onChange,
  suggestions,
  color,
  placeholder,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  suggestions: string[];
  color: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string = draft) => {
    const name = raw.trim().replace(/,$/, "").trim();
    if (name && !values.some((v) => v.toLowerCase() === name.toLowerCase())) onChange([...values, name]);
    setDraft("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {values.length > 0 && (
        <div style={s.chips}>
          {values.map((v) => (
            <span key={v} style={s.chip(color)}>
              {v}
              <button
                type="button"
                style={s.chipX}
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <datalist id={id}>
        {suggestions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <input
        className="input"
        list={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={() => add()}
      />
    </div>
  );
}

// What the user decided for each ambiguous name: an existing node ID, or "new".
type Answers = Record<string, string>;
const answerKey = (c: MeetingChoice) => `${c.field}:${c.input.toLowerCase()}`;

export function MeetingForm({
  userId,
  nodes,
  onLogged,
}: {
  userId: string;
  nodes: VertexNode[];
  onLogged: (meeting: VertexNode) => void;
}) {
  const [date, setDate] = useState(todayLocal);
  const [kind, setKind] = useState<MeetingKind>("meeting");
  const [name, setName] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [group, setGroup] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [choices, setChoices] = useState<MeetingChoice[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const namesOf = (type: VertexNode["type"]) => nodes.filter((n) => n.type === type).map((n) => n.name);

  const reset = () => {
    setDate(todayLocal());
    setKind("meeting");
    setName("");
    setAttendees([]);
    setGroup("");
    setTopics([]);
    setNotes("");
    setChoices([]);
    setAnswers({});
    setError("");
  };

  const submit = async (decided: Answers = answers) => {
    if (!date) return setError("Pick a date.");
    if (attendees.length === 0 && !group.trim()) return setError("Add at least one attendee or a group.");
    setBusy(true);
    setError("");
    // Swap answered names for the chosen node ID; names marked "new" go in confirmNew.
    const resolve = (field: MeetingChoice["field"], value: string) => {
      const a = decided[`${field}:${value.toLowerCase()}`];
      return a && a !== "new" ? a : value;
    };
    const confirmNew = Object.entries(decided)
      .filter(([, a]) => a === "new")
      .map(([k]) => k.slice(k.indexOf(":") + 1));
    try {
      const result = await logMeetingAction(userId, {
        date,
        name: name.trim() || undefined,
        ...(kind === "event" ? { kind } : {}),
        attendees: attendees.map((a) => resolve("attendees", a)),
        group: group.trim() ? resolve("group", group.trim()) : undefined,
        topics: topics.map((t) => resolve("topics", t)),
        notes: notes.trim() || undefined,
        confirmNew,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.value.status === "needs_choice") {
        setChoices(result.value.choices);
        return;
      }
      reset();
      onLogged(result.value.meeting);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't log the ${kind}.`);
    } finally {
      setBusy(false);
    }
  };

  const answer = (c: MeetingChoice, value: string) => {
    const next = { ...answers, [answerKey(c)]: value };
    setAnswers(next);
    // Once every ambiguous name has an answer, log it without another click.
    if (choices.every((ch) => next[answerKey(ch)])) void submit(next);
  };

  return (
    <div style={s.form}>
      <div style={s.chips} role="group" aria-label="Meeting or event">
        {(["meeting", "event"] as const).map((k) => (
          <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "meeting" ? "Meeting" : "Event (luncheon, talk…)"}
          </button>
        ))}
      </div>
      <div style={s.row}>
        <input
          className="input"
          style={{ flex: "0 0 170px" }}
          type="date"
          aria-label={kind === "event" ? "Event date" : "Meeting date"}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input"
          style={{ flex: 1, minWidth: 180 }}
          placeholder="Name (optional, defaults to date · group)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <p className="label" style={s.label}>Who was there (besides you)</p>
      <ChipInput
        id="meeting-attendees"
        values={attendees}
        onChange={setAttendees}
        suggestions={namesOf("person")}
        color={NODE_TYPE_COLOR.person}
        placeholder="Type a name, press Enter"
      />

      <p className="label" style={s.label}>Group (optional)</p>
      <datalist id="meeting-groups">
        {namesOf("group").map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <input
        className="input"
        list="meeting-groups"
        placeholder="e.g. PSAC"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
      />

      <p className="label" style={s.label}>Topics (optional)</p>
      <ChipInput
        id="meeting-topics"
        values={topics}
        onChange={setTopics}
        suggestions={namesOf("topic")}
        color={NODE_TYPE_COLOR.topic}
        placeholder="Type a topic, press Enter"
      />

      <p className="label" style={s.label}>Notes (markdown)</p>
      <textarea
        className="input"
        style={{ minHeight: 90, resize: "vertical" }}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="What came up, decisions, next steps…"
      />

      {choices.length > 0 && (
        <div style={s.choiceBox} role="group" aria-label="Which did you mean?">
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Which did you mean? Nothing is saved until you pick.</p>
          {choices.map((c) => {
            const picked = answers[answerKey(c)];
            return (
              <div key={answerKey(c)} style={{ marginBottom: 10 }}>
                <p style={{ margin: "0 0 6px" }}>
                  &ldquo;{c.input}&rdquo;{" "}
                  {c.reason === "archived" ? "matches an archived node:" : c.reason === "similar" ? "looks like:" : "matches several:"}
                </p>
                <div style={s.chips}>
                  {c.candidates.map((cand) => (
                    <button
                      key={cand.id}
                      type="button"
                      className="chip"
                      style={{ textTransform: "none" }}
                      aria-pressed={picked === cand.id}
                      onClick={() => answer(c, cand.id)}
                    >
                      {cand.name}
                      {cand.role ? ` · ${cand.role}` : ""}
                      {cand.status === "archived" ? " (archived)" : ""}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip"
                    style={{ textTransform: "none" }}
                    aria-pressed={picked === "new"}
                    onClick={() => answer(c, "new")}
                  >
                    New {c.field === "attendees" ? "person" : c.field === "group" ? "group" : "topic"}: {c.input}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-start" }} onClick={() => void submit()} disabled={busy}>
        {busy ? "Logging…" : kind === "event" ? "Log event" : "Log meeting"}
      </button>
    </div>
  );
}
