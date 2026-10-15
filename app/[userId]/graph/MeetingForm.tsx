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
  label: { fontFamily: "var(--font-body)", fontSize: 12, color: "var(--color-teal-deep)", margin: "2px 0 -4px" },
  row: { display: "flex", gap: 10, flexWrap: "wrap" as const },
  chips: { display: "flex", flexWrap: "wrap" as const, gap: 6 },
  chip: (color: string) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 6px 4px 10px",
    borderRadius: 9999,
    border: `1.5px solid ${color}`,
    background: "var(--color-white)",
  }),
  chipX: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--color-teal-deep)",
    fontSize: 13,
    lineHeight: 1,
    padding: "0 4px",
  },
  submit: {
    fontFamily: "var(--font-body)",
    background: "var(--color-gold)",
    color: "var(--color-on-light)",
    border: "none",
    borderRadius: 9999,
    padding: "10px 20px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    alignSelf: "flex-start" as const,
  },
  error: { fontFamily: "var(--font-body)", color: "var(--color-danger)", fontSize: 12.5, margin: 0 },
  choiceBox: {
    border: "1.5px solid var(--color-gold)",
    borderRadius: 10,
    padding: "10px 12px",
    background: "var(--color-white)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
  },
  choiceBtn: (picked: boolean) => ({
    fontFamily: "var(--font-body)",
    fontSize: 12.5,
    padding: "5px 11px",
    borderRadius: 9999,
    border: `1.5px solid ${picked ? "var(--color-teal-deep)" : "var(--color-lavender)"}`,
    background: picked ? "var(--color-teal-deep)" : "var(--color-white)",
    color: picked ? "var(--color-white)" : "var(--color-ink)",
    cursor: "pointer",
  }),
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
        style={s.input}
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
      if (result.status === "needs_choice") {
        setChoices(result.choices);
        return;
      }
      reset();
      onLogged(result.meeting);
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
          <button key={k} type="button" style={s.choiceBtn(kind === k)} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === "meeting" ? "Meeting" : "Event (luncheon, talk…)"}
          </button>
        ))}
      </div>
      <div style={s.row}>
        <input
          style={{ ...s.input, flex: "0 0 170px" }}
          type="date"
          aria-label={kind === "event" ? "Event date" : "Meeting date"}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          style={{ ...s.input, flex: 1, minWidth: 180 }}
          placeholder="Name (optional, defaults to date · group)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <p style={s.label}>Who was there (besides you)</p>
      <ChipInput
        id="meeting-attendees"
        values={attendees}
        onChange={setAttendees}
        suggestions={namesOf("person")}
        color={NODE_TYPE_COLOR.person}
        placeholder="Type a name, press Enter"
      />

      <p style={s.label}>Group (optional)</p>
      <datalist id="meeting-groups">
        {namesOf("group").map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <input
        style={s.input}
        list="meeting-groups"
        placeholder="e.g. PSAC"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
      />

      <p style={s.label}>Topics (optional)</p>
      <ChipInput
        id="meeting-topics"
        values={topics}
        onChange={setTopics}
        suggestions={namesOf("topic")}
        color={NODE_TYPE_COLOR.topic}
        placeholder="Type a topic, press Enter"
      />

      <p style={s.label}>Notes (markdown)</p>
      <textarea
        style={{ ...s.input, minHeight: 90, resize: "vertical" }}
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
                      style={s.choiceBtn(picked === cand.id)}
                      onClick={() => answer(c, cand.id)}
                    >
                      {cand.name}
                      {cand.role ? ` · ${cand.role}` : ""}
                      {cand.status === "archived" ? " (archived)" : ""}
                    </button>
                  ))}
                  <button type="button" style={s.choiceBtn(picked === "new")} onClick={() => answer(c, "new")}>
                    New {c.field === "attendees" ? "person" : c.field === "group" ? "group" : "topic"}: {c.input}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p style={s.error}>{error}</p>}
      <button type="button" style={s.submit} onClick={() => void submit()} disabled={busy}>
        {busy ? "Logging…" : kind === "event" ? "Log event" : "Log meeting"}
      </button>
    </div>
  );
}
